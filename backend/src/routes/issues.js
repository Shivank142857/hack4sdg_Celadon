import { Router } from 'express';
import { createIssuesController } from '../controllers/issuesController.js';

export function createIssuesRouter(service) {
  const router = Router();
  const controller = createIssuesController(service);
  // Express 5 forwards rejected async controllers to the error middleware.
  router.post('/', controller.create);
  router.post('/check-duplicate', controller.checkDuplicate);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  return router;
}
