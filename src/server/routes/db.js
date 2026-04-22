import { Router } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { assertCollectionAllowed, getCollectionModel } from '../services/db.js';
import { deleteImageObject } from '../services/storage.js';

function hasAccess(policy, action, user) {
  const requiredRole = policy[action] || policy.write || policy.read;
  if (!requiredRole) return false;
  if (requiredRole === 'user') return Boolean(user);
  return user?.role === 'admin';
}

export function createDbRouter() {
  const router = Router();

  router.get('/:collection', async (req, res, next) => {
    try {
      const policy = assertCollectionAllowed(req.params.collection);
      if (!hasAccess(policy, 'read', req.user)) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }

      const Model = getCollectionModel(req.params.collection);
      const filter = {};

      if (req.query.active) filter.active = req.query.active === 'true';
      if (policy.queryByUser && req.query.user) filter.user = req.query.user;

      let query = Model.find(filter);
      if (policy.sort) query = query.sort(policy.sort);
      if (req.query.limit) query = query.limit(Math.min(Number(req.query.limit), 5000));

      const docs = await query.lean();
      res.json(docs.map((doc) => ({ ...doc, id: doc._id })));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:collection/:id', async (req, res, next) => {
    try {
      const policy = assertCollectionAllowed(req.params.collection);
      if (!hasAccess(policy, 'read', req.user)) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }

      const Model = getCollectionModel(req.params.collection);
      const doc = await Model.findById(req.params.id).lean();
      res.json(doc ? { ...doc, id: doc._id } : null);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:collection', async (req, res, next) => {
    try {
      const policy = assertCollectionAllowed(req.params.collection);
      const action = policy.create ? 'create' : 'write';
      if (!hasAccess(policy, action, req.user)) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }

      const Model = getCollectionModel(req.params.collection);
      const data = { ...req.body };
      let id = data.id || data._id;
      delete data.id;
      delete data._id;

      if (id && !String(id).startsWith('new_')) {
        await Model.findByIdAndUpdate(id, { $set: data }, { upsert: true, new: true });
      } else {
        id = new mongoose.Types.ObjectId().toString();
        await Model.create({ _id: id, ...data });
      }

      res.json({ success: true, id });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:collection/:id', async (req, res, next) => {
    try {
      const policy = assertCollectionAllowed(req.params.collection);
      if (!hasAccess(policy, 'delete', req.user) && !hasAccess(policy, 'write', req.user)) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }

      const Model = getCollectionModel(req.params.collection);
      const doc = await Model.findById(req.params.id).lean();
      if (req.params.collection === 'images' && doc?.storageKey) {
        await deleteImageObject(doc.storageKey).catch(() => {});
      }
      await Model.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
