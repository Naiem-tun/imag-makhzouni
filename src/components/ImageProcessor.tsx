import React, { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react';
import { Upload, Download, RefreshCw, Image as ImageIcon, Loader2, Lock } from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';

type ProcessingStatus = 'idle' | 'processing' | 'done' | 'error';

export default function ImageProcessor() {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (status === 'processing') return;
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processImage(files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processImage(e.target.files[0]);
      // Reset input so the same file could be selected again if needed
      e.target.value = '';
    }
  };

  const processImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('الرجاء اختيار ملف صورة صالح.');
      setStatus('error');
      return;
    }

    setStatus('processing');
    setProgressMsg('جارٍ تجهيز الأداة...');
    setProgressPercent(0);
    setErrorMsg('');

    try {
      // 1. Remove background
      const blob = await removeBackground(file, {
        progress: (key, current, total) => {
          let msg = 'تتم المعالجة محلياً للحفاظ على الخصوصية...';
          let percent = 0;
          if (key.includes('fetch') || key.includes('download')) {
            msg = 'جارٍ تحميل النماذج الذكية لأول مرة (قد يستغرق بعض الوقت)...';
            percent = Math.round((current / total) * 100) || 0;
          } else if (key.includes('compute')) {
            msg = 'جارٍ إزالة الخلفية وفصل المنتج...';
            percent = Math.round((current / total) * 100) || 0;
          }
          setProgressMsg(msg);
          setProgressPercent(Math.min(95, percent)); // cap at 95 until canvas is done
        }
      });

      setProgressMsg('جارٍ إعداد الصورة النهائية...');
      setProgressPercent(95);

      // 2. Draw to Canvas
      const finalImageURL = await createFinalImage(blob);
      setResultImageUrl(finalImageURL);
      setStatus('done');
      setProgressMsg('');
      setProgressPercent(100);
      
    } catch (error) {
      console.error('Error processing image:', error);
      setStatus('error');
      setErrorMsg('حدث خطأ أثناء معالجة الصورة. الرجاء المحاولة مرة أخرى.');
    }
  };

  const createFinalImage = (bgRemovedBlob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          // 1. Get exact bounding box of the non-transparent pixels
          const offscreenCanvas = document.createElement('canvas');
          offscreenCanvas.width = img.width;
          offscreenCanvas.height = img.height;
          const offctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
          if (!offctx) {
            reject(new Error('Offscreen canvas context not available'));
            return;
          }
          offctx.drawImage(img, 0, 0);
          const imgData = offctx.getImageData(0, 0, img.width, img.height);
          const data = imgData.data;

          let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
          let hasPixels = false;

          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
              const alpha = data[(y * img.width + x) * 4 + 3];
              if (alpha > 10) { // Non-transparent pixel
                hasPixels = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (!hasPixels) {
            minX = 0; minY = 0; maxX = img.width; maxY = img.height;
          }

          const productWidth = maxX - minX;
          const productHeight = maxY - minY;

          // 2. Prepare final 800x800 canvas
          const canvas = document.createElement('canvas');
          const CANVAS_SIZE = 800;
          canvas.width = CANVAS_SIZE;
          canvas.height = CANVAS_SIZE;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          // Fill with white
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

          // Calculate dimensions and position
          const PADDING_PERCENT = 0.12;
          const padding = CANVAS_SIZE * PADDING_PERCENT;
          const maxInnerSize = CANVAS_SIZE - (padding * 2);

          const scale = Math.min(maxInnerSize / productWidth, maxInnerSize / productHeight);
          const drawWidth = productWidth * scale;
          const drawHeight = productHeight * scale;

          const x = (CANVAS_SIZE - drawWidth) / 2;
          const y = (CANVAS_SIZE - drawHeight) / 2;

          // Apply Brightness & Contrast (5%)
          ctx.filter = 'brightness(105%) contrast(105%)';

          // Apply realistic drop shadow
          ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
          ctx.shadowBlur = 25;
          ctx.shadowOffsetY = 15;
          ctx.shadowOffsetX = 0;

          // Draw cropped subject image onto final canvas
          ctx.drawImage(
            offscreenCanvas,
            minX, minY, productWidth, productHeight,
            x, y, drawWidth, drawHeight
          );

          // Reset context options
          ctx.filter = 'none';
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.shadowOffsetX = 0;

          // Convert to JPG
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load processed image data.'));
      };

      img.src = URL.createObjectURL(bgRemovedBlob);
    });
  };

  const reset = () => {
    setStatus('idle');
    setProgressMsg('');
    setProgressPercent(0);
    setResultImageUrl(null);
    setErrorMsg('');
  };

  const downloadImage = async () => {
    if (!resultImageUrl) return;
    
    try {
      // تحويل Data URL إلى Blob لضمان التوافقية مع جميع الهواتف والمتصفحات
      const byteString = atob(resultImageUrl.split(',')[1]);
      const mimeString = resultImageUrl.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeString });
      const filename = `product-${Date.now()}.jpg`;

      // 1. محاولة استخدام Web Share API (ممتاز لتطبيقات الـ PWA والهواتف)
      if (navigator.canShare) {
        const file = new File([blob], filename, { type: mimeString });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'صورة المنتج',
            });
            return; // تمت العملية بنجاح عبر المشاركة
          } catch (shareErr: any) {
            // المستخدم ألغى المشاركة أو حدث خطأ
            if (shareErr.name !== 'AbortError') {
              console.log('Share API error:', shareErr);
            }
          }
        }
      }

      // 2. الطريقة التقليدية (للكمبيوتر أو إذا فشلت المشاركة)
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error('Failed to download image:', err);
      alert('حدث خطأ أثناء حفظ الصورة. يرجى المحاولة مرة أخرى.');
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-200 flex items-center justify-center font-sans p-4" dir="rtl">
      <div className="w-[360px] h-[640px] bg-slate-50 rounded-[3rem] shadow-2xl border-[8px] border-slate-800 overflow-hidden relative flex flex-col shrink-0">
        
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-800 rounded-b-2xl z-20"></div>

        <header className="pt-10 pb-4 px-6 bg-white border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">imag-makhzouni</h1>
            <p className="text-[10px] text-blue-500 font-semibold uppercase tracking-wider">Image Processor Pro</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-blue-500" />
          </div>
        </header>

        <main className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
          {status === 'idle' && (
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="flex-1 bg-white rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-4 text-center group cursor-pointer hover:border-blue-300 transition-colors relative overflow-hidden shrink-0 min-h-[250px]"
              >
                  <div className="w-full h-full absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                    <div className="w-48 h-48 border border-slate-300 rounded-lg"></div>
                  </div>
                  
                  <div className="z-10">
                    <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Upload className="w-8 h-8 text-blue-500" />
                    </div>
                    <h3 className="text-slate-700 font-bold mb-1">ارفع صورة المنتج</h3>
                    <p className="text-xs text-slate-400 px-4">اسحب الملف هنا أو انقر لاختيار صورة</p>
                  </div>
              </div>
          )}

          {status === 'processing' && (
              <div className="flex-1 flex flex-col justify-center gap-4">
                  <div className="flex-1 bg-white rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-4 relative overflow-hidden">
                     <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-6" />
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm shrink-0">
                    <div className="flex items-center justify-between mb-2">
                       <span className="text-[11px] font-bold text-slate-500 flex items-center gap-2">
                         <Loader2 className="w-3 h-3 animate-spin text-slate-400"/>
                         جاري المعالجة...
                       </span>
                       <span className="text-[11px] text-blue-600 font-bold">{progressPercent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                       <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-400 text-center">{progressMsg}</p>
                  </div>
              </div>
          )}

          {status === 'error' && (
             <div className="flex-1 flex flex-col justify-center gap-4">
                  <div className="flex-1 bg-white rounded-3xl border-2 border-dashed border-red-200 flex flex-col items-center justify-center p-4 relative overflow-hidden text-center">
                    <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4 text-red-500 font-bold text-xl">
                      !
                    </div>
                    <p className="text-sm font-semibold text-red-700 mb-2">عذراً</p>
                    <p className="text-xs text-red-500 leading-relaxed">{errorMsg}</p>
                  </div>
              </div>
          )}
          
          {status === 'done' && resultImageUrl && (
               <div className="flex-1 flex flex-col">
                  <div className="flex-1 bg-white rounded-3xl border border-slate-200 flex items-center justify-center p-2 relative overflow-hidden shrink-0 min-h-[250px]">
                      <img 
                        src={resultImageUrl} 
                        alt="Product Ready" 
                        className="w-full h-full object-contain rounded-2xl"
                      />
                  </div>
               </div>
          )}
          
          <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex gap-3 items-center mt-auto shrink-0">
            <div className="bg-blue-500 p-1.5 rounded-lg shrink-0 flex items-center justify-center">
                <Lock className="w-3.5 h-3.5 text-white" />
            </div>
            <p className="text-[10px] leading-tight text-blue-900 font-medium">
              تتم المعالجة محلياً للحفاظ على الخصوصية.<br/>
              <span className="opacity-60">لا يتم إرسال بياناتك إلى أي خادم خارجي.</span>
            </p>
          </div>
        </main>

        <footer className="p-6 bg-white border-t border-slate-100 grid grid-cols-2 gap-3 shrink-0">
          <button 
            disabled={status !== 'done'}
            onClick={downloadImage}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs transition-opacity ${status === 'done' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-blue-600 opacity-50 text-white cursor-not-allowed'}`}
          >
            <Download className="w-4 h-4 pointer-events-none" />
            حفظ JPG
          </button>
          
          <button 
            onClick={reset}
            className="flex items-center justify-center gap-2 py-3 bg-slate-50 text-slate-600 border border-slate-200 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4 pointer-events-none" />
            إعادة ضبط
          </button>
        </footer>

        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />

      </div>
      
    </div>
  );
}
