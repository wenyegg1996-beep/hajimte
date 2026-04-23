import { createServerApp } from '../src/server/app.js';

let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = createServerApp();
  }
  return appPromise;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
