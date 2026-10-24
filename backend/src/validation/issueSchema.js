import { z } from 'zod';

export const categories = ['pothole', 'garbage', 'streetlight', 'water_leak'];
export const statuses = ['reported', 'assigned', 'in_progress', 'resolved'];

export const createIssueSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  category: z.enum(categories),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  severity: z.number().int().min(1).max(5),
});

export const issueFiltersSchema = z.strictObject({
  category: z.enum(categories).optional(),
  status: z.enum(statuses).optional(),
});

export const issueIdSchema = z.uuid();

export const duplicateCheckSchema = z.strictObject({
  category: z.enum(categories),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
