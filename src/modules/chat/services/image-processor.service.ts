import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ProcessedContent } from '../interfaces/processor.interface';
import { LangSmithService } from './langsmith.service';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import { unlink } from 'fs/promises';

@Injectable()
export class ImageProcessorService {
  private visionModel: ChatOpenAI;

  constructor(
    private langSmith: LangSmithService,
    private configService: ConfigService,
  ) {
    this.visionModel = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-4o',
    });
  }

  async processImage(file: Express.Multer.File): Promise<ProcessedContent> {
    try {
      const optimizedBuffer = await sharp(file.path)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const base64Image = optimizedBuffer.toString('base64');
      
      const analysisPrompt = `
        Analyze this image and provide a detailed description including:
        1. Objects and entities present
        2. Text content if any (OCR)
        3. Overall context and scene description
        4. Any relevant details for search and retrieval
        5. Emotional tone or mood if applicable
        6. Colors, composition, and visual elements
        
        Make the description comprehensive for semantic search purposes.
      `;

      const analysisResponse = await this.visionModel.invoke([
        {
          role: 'user',
          content: [
            { type: 'text', text: analysisPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        },
      ]);

      const analysis = analysisResponse.content as string;
      const processedContent: ProcessedContent = {
        type: 'image',
        content: analysis,
        metadata: {
          filename: file.originalname,
          fileType: file.mimetype,
          size: file.size,
          dimensions: await this.getImageDimensions(file.path),
        },
      };

      await this.langSmith.traceRun('image_processing', {
        filename: file.originalname,
        fileType: file.mimetype,
        size: file.size,
      }, {
        analysisLength: analysis.length,
        success: true,
      });

      // Delete the file after successful processing
      await this.cleanupFile(file.path);

      return processedContent;
    } catch (error) {
      // Clean up file even if processing fails
      await this.cleanupFile(file.path);
      
      await this.langSmith.traceRun('image_processing_error', {
        filename: file.originalname,
      }, {}, error as Error);
      throw error;
    }
  }

  private async getImageDimensions(filePath: string): Promise<{ width: number; height: number }> {
    try {
      const metadata = await sharp(filePath).metadata();
      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
      console.log(`Deleted processed image: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete image ${filePath}:`, error);
    }
  }
}
