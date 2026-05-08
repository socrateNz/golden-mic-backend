import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVoteConfirmationEmail(params: {
  to: string;
  voterName: string;
  candidateName: string;
  amount: number;
  points: number;
}) {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: params.to,
      subject: `✅ Vote confirmé pour ${params.candidateName} — Golden Mic 237`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #fff; padding: 32px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #f59e0b; font-size: 28px; margin: 0;">🎤 Golden Mic 237</h1>
            <p style="color: #6b7280; margin-top: 8px;">Compétition Musicale Camerounaise</p>
          </div>
          <h2 style="color: #fff; font-size: 20px;">Vote Confirmé ✅</h2>
          <p style="color: #d1d5db;">Bonjour <strong>${params.voterName}</strong>,</p>
          <p style="color: #d1d5db;">Votre vote pour <strong style="color: #f59e0b;">${params.candidateName}</strong> a été enregistré avec succès !</p>
          <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 24px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 4px 0; color: #9ca3af;">Montant payé</p>
            <p style="margin: 4px 0; font-size: 24px; font-weight: bold; color: #fff;">${params.amount.toLocaleString('fr-FR')} FCFA</p>
            <p style="margin: 12px 0 4px 0; color: #9ca3af;">Points attribués</p>
            <p style="margin: 4px 0; font-size: 24px; font-weight: bold; color: #f59e0b;">+${params.points} points</p>
          </div>
          <p style="color: #6b7280; font-size: 14px; text-align: center; margin-top: 32px;">
            Merci de soutenir la musique camerounaise 🇨🇲
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error('[Resend] Failed to send vote confirmation email:', error);
  }
}

export async function sendCandidateRegistrationEmail(params: {
  to: string;
  candidateName: string;
  artistName: string;
}) {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: params.to,
      subject: `🎤 Inscription reçue — Golden Mic 237`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #fff; padding: 32px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #f59e0b; font-size: 28px; margin: 0;">🎤 Golden Mic 237</h1>
          </div>
          <h2 style="color: #fff;">Votre inscription est en cours de validation</h2>
          <p style="color: #d1d5db;">Bonjour <strong>${params.candidateName}</strong> (${params.artistName}),</p>
          <p style="color: #d1d5db;">Votre dossier de candidature a bien été reçu. Notre équipe va le valider dans les plus brefs délais.</p>
          <p style="color: #d1d5db;">Vous recevrez un email de confirmation dès que votre profil sera approuvé.</p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">L'équipe Golden Mic 237 🇨🇲</p>
        </div>
      `,
    });
  } catch (error) {
    console.error('[Resend] Failed to send registration email:', error);
  }
}
