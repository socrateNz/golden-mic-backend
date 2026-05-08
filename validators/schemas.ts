import { z } from 'zod';

export const initiateVoteSchema = z.object({
  candidateId: z.string().uuid({ message: 'ID candidat invalide' }),
  amount: z
    .number({ message: 'Le montant est requis' })
    .int()
    .min(100, 'Montant minimum 100 FCFA')
    .max(1_000_000, 'Montant maximum 1 000 000 FCFA'),
  voterName: z.string().min(2).max(100).optional(),
  voterEmail: z.string().email().optional(),
  voterPhone: z
    .string()
    .trim()
    .regex(/^(237)?[62][0-9]{8}$/, 'Numéro camerounais invalide')
    .optional(),
});

export type InitiateVoteInput = z.infer<typeof initiateVoteSchema>;

export const candidateRegistrationSchema = z.object({
  fullName: z.string().min(2, 'Nom requis').max(255),
  artistName: z.string().min(2, 'Nom artiste requis').max(255),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)'),
  region: z.enum([
    'Adamaoua', 'Centre', 'Est', 'Extrême-Nord', 'Littoral',
    'Nord', 'Nord-Ouest', 'Ouest', 'Sud', 'Sud-Ouest',
  ]),
  categoryId: z.string().uuid({ message: 'Catégorie invalide' }),
  phone: z
    .string()
    .regex(/^(237)?[62][0-9]{8}$/, 'Numéro camerounais invalide'),
  email: z.string().email().optional(),
  biography: z.string().min(50, 'Biographie minimum 50 caractères').max(2000),
  instagramUrl: z.string().url().optional().or(z.literal('')),
  facebookUrl: z.string().url().optional().or(z.literal('')),
  tiktokUrl: z.string().url().optional().or(z.literal('')),
  youtubeUrl: z.string().url().optional().or(z.literal('')),
  videoUrl: z.string().url().optional().or(z.literal('')),
});

export type CandidateRegistrationInput = z.infer<typeof candidateRegistrationSchema>;

export const sponsorRequestSchema = z.object({
  companyName: z.string().min(2).max(255),
  contactName: z.string().min(2).max(255),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  sponsorshipType: z.enum(['gold', 'silver', 'bronze', 'media', 'tech']),
  amount: z.number().min(0).optional(),
  message: z.string().max(1000).optional(),
});

export type SponsorRequestInput = z.infer<typeof sponsorRequestSchema>;

export const candidatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  region: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(['points', 'recent', 'votes']).default('points'),
});
