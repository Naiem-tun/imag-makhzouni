import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '50mb' }));

  // API constraints: 
  // - Send image to Photoroom API using user's API KEY 
  app.post('/api/photoroom/studio', upload.single('image'), async (req, res) => {
    try {
      if (!process.env.PHOTOROOM_API_KEY) {
        return res.status(400).json({ error: 'PHOTOROOM_API_KEY environment variable is required' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
      }

      // We are creating a formdata to send to Photoroom.
      // Assuming endpoint: https://image-api.photoroom.com/v2/edit
      const formData = new FormData();
      formData.append('image_file', req.file.buffer, req.file.originalname || 'image.png');
      formData.append('background.color', '#FFFFFF');
      formData.append('padding', '0.12');
      formData.append('shadow.mode', 'ai.soft');

      const response = await axios.post(
        'https://image-api.photoroom.com/v2/edit',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'x-api-key': process.env.PHOTOROOM_API_KEY,
          },
          responseType: 'arraybuffer', // We expect binary image back
        }
      );

      // Send the output image back as base64 or raw bits
      const base64Image = Buffer.from(response.data, 'binary').toString('base64');
      res.json({ success: true, imageBase64: `data:image/jpeg;base64,${base64Image}` });

    } catch (error: any) {
      console.error('Error in Photoroom API:', error.response?.data?.toString() || error.message);
      res.status(500).json({ 
        error: 'فشل معالجة الصورة عبر الذكاء الاصطناعي', 
        details: error.message 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
