import { createIssueSchema, duplicateCheckSchema, issueFiltersSchema, issueIdSchema } from '../validation/issueSchema.js';

function requireJson(req, res) {
  if (req.is('application/json')) return true;
  res.status(415).json({
    error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use Content-Type: application/json.' },
  });
  return false;
}

function validate(schema, value, res) {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return null;
  }
  return result;
}

export function createIssuesController(service) {
  return {
    async create(req, res) {
      if (!requireJson(req, res)) return;
      const input = validate(createIssueSchema, req.body, res);
      if (!input) return;
      const issue = await service.createIssue(input.data);
      res.location(`/api/issues/${issue.id}`).status(201).json({ data: issue });
    },

    async list(req, res) {
      const filters = validate(issueFiltersSchema, req.query, res);
      if (!filters) return;
      res.json({ data: await service.listIssues(filters.data) });
    },

    async checkDuplicate(req, res) {
      if (!requireJson(req, res)) return;
      const input = validate(duplicateCheckSchema, req.body, res);
      if (!input) return;
      res.json({ data: await service.checkDuplicates(input.data) });
    },

    async getById(req, res) {
      const id = validate(issueIdSchema, req.params.id, res);
      if (!id) return;
      const issue = await service.getIssue(id.data);
      if (!issue) {
        return res.status(404).json({
          error: { code: 'ISSUE_NOT_FOUND', message: 'Issue not found.' },
        });
      }
      res.json({ data: issue });
    },
  };
}
