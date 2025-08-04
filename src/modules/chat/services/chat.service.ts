import { Injectable } from '@nestjs/common';
import { ChatRequestDto, ChatResponseDto } from '../dto/chat.dto';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessorService } from './image-processor.service';
import { DocumentProcessorService } from './document-processor.service';
import { WorkflowService } from './workflow.service';
import { LangSmithService } from './langsmith.service';
import { WorkflowState } from '../interfaces/processor.interface';

@Injectable()
export class ChatService {

  constructor(
    private imageProcessor: ImageProcessorService,
    private documentProcessor: DocumentProcessorService,
    private workflowService: WorkflowService,
    private langSmith: LangSmithService
  ) {}

  async processChat(
    request: ChatRequestDto,
    files?: Express.Multer.File[],
  ): Promise<ChatResponseDto> {
    const startTime = Date.now();
    const sessionId = request.sessionId || uuidv4();

    try {
      const workflowState: WorkflowState = {
        textInput: request.message,
        images: [],
        documents: [],
        retrievedContext: [],
        chatHistory: [],
        finalResponse: undefined,
        sessionId,
      }

      if (files && files.length > 0) {
        await this.processFiles(files, workflowState);
      }

      const result = await this.workflowService.executeWorkflow(workflowState);

      const processingTime = Date.now() - startTime;

      const response: ChatResponseDto = {
        response: result.finalResponse || 'No response generated',
        sessionId,
        metadata: {
          processedFiles: files?.length || 0,
          processingTime,
          vectorStoreHits: result.retrievedContext.length,
        },
      };

      await this.langSmith.logInteraction(
        sessionId,
        request,
        { ...response },
        {
          processingTime,
          fileCount: files?.length || 0,
        },
       
      );

      return response;
    } catch (error) {
      await this.langSmith.traceRun('chat_service_error', {
        sessionId,
        request,
      }, {}, error as Error);
      throw error;
    }
  }

  private async processFiles(
    files: Express.Multer.File[],
    state: WorkflowState,
  ) {
    for (const file of files) {
      try {
        if (this.isImageFile(file)) {
          const processedImage = await this.imageProcessor.processImage(file);
          state.images.push(processedImage);
          console.log(JSON.stringify(state))
        } else if (this.isDocumentFile(file)) {
          const processedDocs =
            await this.documentProcessor.processDocument(file);
          state.documents.push(...processedDocs);
        }
      } catch (error) {
        console.error(`Error processing file ${file.originalname}:`, error);
      }
    }
  }

  private isImageFile(file: Express.Multer.File): boolean {
    return file.mimetype.startsWith('image/');
  }

  private isDocumentFile(file: Express.Multer.File): boolean {
    const documentMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    return documentMimeTypes.includes(file.mimetype);
  }
}
