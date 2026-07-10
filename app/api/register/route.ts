import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { candidateRegistrationSchema } from '@/validators/schemas';
import { uploadImage } from '@/lib/cloudinary';
import { generateSlug } from '@/utils/helpers';
import { sendCandidateRegistrationEmail } from '@/lib/resend';
import { handleCors, withCors } from '@/middleware/cors';

function verifyAdminToken(req: NextRequest): boolean {
  return req.headers.get('x-admin-token') === process.env.ADMIN_JWT_SECRET;
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  if (!verifyAdminToken(req)) {
    return withCors(
      NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
      origin
    );
  }

  try {
    const formData = await req.formData();

    // Extraire les données du formulaire
    const rawData = {
      fullName: formData.get('fullName') as string,
      artistName: formData.get('artistName') as string,
      categoryId: formData.get('categoryId') as string,
      region: formData.get('region') as string,
      phone: formData.get('phone') as string,
      email: formData.get('email') as string | undefined,
      biography: formData.get('biography') as string,
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
      date_of_birth: '2000-01-01',
      region: parsed.data.region,
      category_id: parsed.data.categoryId,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      biography: parsed.data.biography,
      photo_url: photoUrl,
      photo_public_id: photoPublicId,
      video_url: null,
      instagram_url: null,
      facebook_url: null,
      tiktok_url: null,
      youtube_url: null,
      status: 'approved',
      is_trending: false,
      rejection_reason: null,
    });

    // Log d'audit
    await auditRepository.log({
      event_type: 'candidate.created',
      entity_type: 'candidate',
      entity_id: candidate.id,
      actor_type: 'admin',
      details: { artist_name: candidate.artist_name, created_by: 'admin' },
      severity: 'info',
    });

    // Email de confirmation
    if (parsed.data.email) {
      try {
        await sendCandidateRegistrationEmail({
          to: parsed.data.email,
          candidateName: parsed.data.fullName,
          artistName: parsed.data.artistName,
          isApproved: true,
        });
      } catch (emailError) {
        console.error('Erreur lors de l\'envoi de l\'email de confirmation:', emailError);
      }
    }

    return withCors(
      NextResponse.json(
        { success: true, message: 'Candidat inscrit avec succès', data: { id: candidate.id } },
        { status: 201 }
      ),
      origin
    );
  } catch (error: any) {
    console.error("REGISTER ERROR:", error);
    
    if (error?.code === '23505') {
      return withCors(NextResponse.json({ error: 'Un candidat avec ce nom d\'artiste existe déjà.' }, { status: 400 }), origin);
    }
    
    const message = error?.message || 'Erreur serveur';
    return withCors(NextResponse.json({ error: message, details: error }, { status: 500 }), origin);
  }
}
