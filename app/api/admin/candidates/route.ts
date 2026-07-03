import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { handleCors, withCors } from '@/middleware/cors';
import { candidateRegistrationSchema } from '@/validators/schemas';
import { uploadImage } from '@/lib/cloudinary';
import { generateSlug } from '@/utils/helpers';

function verifyAdminToken(req: NextRequest): boolean {
  return req.headers.get('x-admin-token') === process.env.ADMIN_JWT_SECRET;
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

// GET /api/admin/candidates — Liste tous les candidats
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const data = await candidateRepository.findAllAdmin(status);
  return withCors(NextResponse.json({ success: true, data }), origin);
}

// PATCH /api/admin/candidates — Modifier profil OU Valider / Rejeter / Suspendre
export async function PATCH(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }
  try {
    const contentType = req.headers.get('content-type') || '';

    // CAS 1 : Mise à jour complète du profil (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const id = formData.get('id') as string;
      if (!id) {
        return withCors(NextResponse.json({ error: 'id requis' }, { status: 400 }), origin);
      }

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

      // Upload photo si fournie
      const photoFile = formData.get('photo') as File | null;
      let photoUpdateData: { photo_url?: string; photo_public_id?: string } = {};

      if (photoFile && photoFile.size > 0) {
        const buffer = Buffer.from(await photoFile.arrayBuffer());
        const uploaded = await uploadImage(buffer, 'candidates');
        photoUpdateData = {
          photo_url: uploaded.url,
          photo_public_id: uploaded.publicId,
        };
      }

      // Régénère le slug si le nom de l'artiste a pu changer
      const baseSlug = generateSlug(parsed.data.artistName);
      const slug = `${baseSlug}-${Date.now().toString(36)}`;

      // Met à jour en base de données
      const updated = await candidateRepository.update(id, {
        full_name: parsed.data.fullName,
        artist_name: parsed.data.artistName,
        slug,
        date_of_birth: parsed.data.dateOfBirth,
        region: parsed.data.region,
        category_id: parsed.data.categoryId,
        phone: parsed.data.phone,
        email: parsed.data.email ?? null,
        biography: parsed.data.biography,
        video_url: parsed.data.videoUrl ?? null,
        instagram_url: parsed.data.instagramUrl ?? null,
        facebook_url: parsed.data.facebookUrl ?? null,
        tiktok_url: parsed.data.tiktokUrl ?? null,
        youtube_url: parsed.data.youtubeUrl ?? null,
        ...photoUpdateData,
      });

      // Audit log
      await auditRepository.log({
        event_type: 'candidate.updated',
        entity_type: 'candidate',
        entity_id: id,
        actor_type: 'admin',
        details: { artist_name: updated.artist_name, updated_by: 'admin' },
        severity: 'info',
      });

      return withCors(NextResponse.json({ success: true, data: updated }), origin);
    }

    // CAS 2 : Mise à jour du statut uniquement (JSON)
    const { id, status, reason } = await req.json();
    if (!id || !status) {
      return withCors(NextResponse.json({ error: 'id et status requis' }, { status: 400 }), origin);
    }
    const allowed = ['approved', 'rejected', 'suspended', 'pending'];
    if (!allowed.includes(status)) {
      return withCors(NextResponse.json({ error: 'Statut invalide' }, { status: 400 }), origin);
    }
    await candidateRepository.updateStatus(id, status, reason);
    await auditRepository.log({
      event_type: `candidate.${status}`,
      entity_type: 'candidate',
      entity_id: id,
      actor_type: 'admin',
      details: { reason },
      severity: 'info',
    });
    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
