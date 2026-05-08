import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { candidateRegistrationSchema } from '@/validators/schemas';
import { uploadImage } from '@/lib/cloudinary';
import { generateSlug } from '@/utils/helpers';
import { sendCandidateRegistrationEmail } from '@/lib/resend';
import { handleCors, withCors } from '@/middleware/cors';

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  try {
    const formData = await req.formData();

    // Extraire les données du formulaire
    const rawData = {
      fullName: formData.get('fullName') as string,
      artistName: formData.get('artistName') as string,
      dateOfBirth: formData.get('dateOfBirth') as string,
      region: formData.get('region') as string,
      categoryId: formData.get('categoryId') as string,
      phone: formData.get('phone') as string,
      email: formData.get('email') as string | undefined,
      biography: formData.get('biography') as string,
      instagramUrl: formData.get('instagramUrl') as string | undefined,
      facebookUrl: formData.get('facebookUrl') as string | undefined,
      tiktokUrl: formData.get('tiktokUrl') as string | undefined,
      youtubeUrl: formData.get('youtubeUrl') as string | undefined,
      videoUrl: formData.get('videoUrl') as string | undefined,
    };

    // Validation Zod
    const parsed = candidateRegistrationSchema.safeParse(rawData);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 }),
        origin
      );
    }

    // Upload photo vers Cloudinary
    const photoFile = formData.get('photo') as File | null;
    let photoUrl: string | null = null;
    let photoPublicId: string | null = null;

    if (photoFile && photoFile.size > 0) {
      const buffer = Buffer.from(await photoFile.arrayBuffer());
      const uploaded = await uploadImage(buffer, 'candidates');
      photoUrl = uploaded.url;
      photoPublicId = uploaded.publicId;
    }

    // Génère le slug unique
    const baseSlug = generateSlug(parsed.data.artistName);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // Crée le candidat
    const candidate = await candidateRepository.create({
      full_name: parsed.data.fullName,
      artist_name: parsed.data.artistName,
      slug,
      date_of_birth: parsed.data.dateOfBirth,
      region: parsed.data.region,
      category_id: parsed.data.categoryId,
      phone: parsed.data.phone,
      email: parsed.data.email ?? null,
      biography: parsed.data.biography,
      photo_url: photoUrl,
      photo_public_id: photoPublicId,
      video_url: parsed.data.videoUrl ?? null,
      instagram_url: parsed.data.instagramUrl ?? null,
      facebook_url: parsed.data.facebookUrl ?? null,
      tiktok_url: parsed.data.tiktokUrl ?? null,
      youtube_url: parsed.data.youtubeUrl ?? null,
      status: 'pending',
      is_trending: false,
      rejection_reason: null,
    });

    // Email de confirmation
    if (parsed.data.email) {
      await sendCandidateRegistrationEmail({
        to: parsed.data.email,
        candidateName: parsed.data.fullName,
        artistName: parsed.data.artistName,
      });
    }

    return withCors(
      NextResponse.json(
        { success: true, message: 'Candidature reçue, en attente de validation', data: { id: candidate.id } },
        { status: 201 }
      ),
      origin
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
