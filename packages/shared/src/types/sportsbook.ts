import { z } from 'zod';

// Sportsbook from OpticOdds API
export const SportsbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().nullable().optional(),
  is_onshore: z.boolean().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
});

export type Sportsbook = z.infer<typeof SportsbookSchema>;

// Sportsbook with target status (our extension)
export const SportsbookWithStatusSchema = SportsbookSchema.extend({
  isTarget: z.boolean(),
  isSharp: z.boolean(),
});

export type SportsbookWithStatus = z.infer<typeof SportsbookWithStatusSchema>;

// OpticOdds sportsbooks response
export const SportsbooksResponseSchema = z.object({
  data: z.array(SportsbookSchema),
});

export type SportsbooksResponse = z.infer<typeof SportsbooksResponseSchema>;
