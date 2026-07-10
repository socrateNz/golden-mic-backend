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
    .min(1, 'Numéro de téléphone requis'),
});

export type InitiateVoteInput = z.infer<typeof initiateVoteSchema>;

export const candidateRegistrationSchema = z.object({
  fullName: z.string().min(2, 'Nom requis').max(255),
  artistName: z.string().min(2, 'Nom artiste requis').max(255),
  categoryId: z.string().uuid({ message: 'Catégorie invalide' }),
  phone: z
    .string()
    .regex(/^(237)?[62][0-9]{8}$/, 'Numéro camerounais invalide'),
  email: z.string().email().optional().or(z.literal('')),
  biography: z.string().min(10, 'Biographie minimum 50 caractères').max(2000),
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
