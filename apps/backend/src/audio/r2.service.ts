import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

@Injectable()
export class R2Service {
  async put(key: string, body: Buffer, contentType: string) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET_NAME;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secretKey = process.env.R2_SECRET_ACCESS_KEY;
    const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
    if (!accountId || !bucket || !accessKey || !secretKey || !publicUrl) {
      throw new ServiceUnavailableException('Cloudflare R2 chưa được cấu hình đầy đủ trong file env.');
    }

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const path = `/${encodeURIComponent(bucket)}/${encodedKey}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const headers = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonical = `PUT\n${path}\n\n${headers}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${date}/auto/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`;
    const hmac = (keyValue: Buffer | string, value: string) => createHmac('sha256', keyValue).update(value).digest();
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), 'auto'), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(`https://${host}${path}`, { method: 'PUT', body: new Blob([new Uint8Array(body)]), headers: {
      'Content-Type': contentType, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: authorization,
    } });
    if (!response.ok) throw new BadRequestException(`Không thể tải âm thanh lên R2 (${response.status}).`);
    return `${publicUrl}/${encodedKey}`;
  }
}
