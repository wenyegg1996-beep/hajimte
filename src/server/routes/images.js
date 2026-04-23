import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { getCollectionModel } from '../services/db.js';
import { saveImageObject, getImageBuffer } from '../services/storage.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createPublicImageRouter() {
  const router = Router();

  router.get('/images/:id', async (req, res, next) => {
    try {
      const ImageModel = getCollectionModel('images');
      const doc = await ImageModel.findById(req.params.id).lean();
      if (!doc) {
        throw new AppError('Image not found', 404, 'IMAGE_NOT_FOUND');
      }

      if (doc.imageData) {
        res.set('Content-Type', doc.mimeType || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(Buffer.from(doc.imageData, 'base64'));
      }

      if (doc.storageKey) {
        try {
          const { buffer, contentType } = await getImageBuffer(doc.storageKey);
          res.set('Content-Type', contentType || doc.mimeType || 'image/jpeg');
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(buffer);
        } catch {
          // fall through to URL redirect
        }
      }

      if (doc.url && doc.url.startsWith('http')) {
        return res.redirect(doc.url);
      }

      throw new AppError('Image asset missing', 404, 'IMAGE_ASSET_MISSING');
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createImageUploadRouter() {
  const router = Router();

  router.post('/upload-image', upload.single('image'), async (req, res, next) => {
    try {
      const title = req.body?.title || '';
      const tags = req.body?.tags || '';
      const time = req.body?.time || new Date().toISOString();
      const ImageModel = getCollectionModel('images');

      let buffer = req.file?.buffer;
      let mimeType = req.file?.mimetype || 'image/jpeg';
      let originalName = req.file?.originalname || 'image.jpg';

      if (!buffer && req.body?.imageData) {
        buffer = Buffer.from(req.body.imageData, 'base64');
        mimeType = req.body?.mimeType || mimeType;
      }

      if (!buffer || !tags) {
        throw new AppError('Missing image data or tags', 400, 'INVALID_IMAGE_UPLOAD');
      }

      const { storageKey, url } = await saveImageObject({ buffer, mimeType, originalName });
      const id = new mongoose.Types.ObjectId().toString();

      await ImageModel.create({
        _id: id,
        title,
        tags,
        url,
        storageKey,
        mimeType,
        time,
      });

      res.json({ success: true, id, url, storageKey });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
