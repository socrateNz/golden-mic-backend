import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

export async function uploadImage(
  fileBuffer: Buffer,
  folder: string,
  publicId?: string
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `golden-mic-237/${folder}`,
        public_id: publicId,
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    uploadStream.end(fileBuffer);
  });
}

export function generateSignature(params: Record<string, string | number>) {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const toSign = Object.entries({ ...params, timestamp })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const signature = require('crypto')
    .createHash('sha256')
    .update(toSign + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');
  return { signature, timestamp };
}
