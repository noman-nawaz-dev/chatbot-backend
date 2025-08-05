import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { ChatHistoryEntry } from '../interfaces/processor.interface';

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadChatHistory(
    sessionId: string,
    chatHistory: ChatHistoryEntry[],
  ): Promise<string> {
    try {
      const chatHistoryJson = JSON.stringify(chatHistory, null, 2);
      const buffer = Buffer.from(chatHistoryJson, 'utf-8');
      
      const uploadOptions: UploadApiOptions = {
        resource_type: 'raw',
        public_id: `chat_history/${sessionId}`,
        format: 'txt',
        overwrite: true,
      };

      const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              reject(error as Error);
            } else {
              resolve(result as { secure_url: string });
            }
          }
        );
        uploadStream.end(buffer);
      });

      return result.secure_url;
    } catch (error) {
      console.error('Error uploading chat history to Cloudinary:', error);
      throw new Error(`Failed to upload chat history: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async downloadChatHistory(fileUrl: string): Promise<ChatHistoryEntry[]> {
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        if (response.status === 404) return []; // If file not found, return empty history
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      
      const text = await response.text();
      if (!text) {
        return [];
      }
      
      return JSON.parse(text) as ChatHistoryEntry[];
    } catch (error) {
      console.error('Error downloading or parsing chat history from Cloudinary:', error);
      // Return empty array to prevent breaking the flow if history is corrupt or unavailable
      return [];
    }
  }
}
