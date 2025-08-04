// src/chat/services/chat.service.ts

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ChatRequestDto, ChatResponseDto } from '../dto/chat.dto';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessorService } from './image-processor.service';
import { DocumentProcessorService } from './document-processor.service';
import { WorkflowService } from './workflow.service';
import { LangSmithService } from './langsmith.service';
import { WorkflowState } from '../interfaces/processor.interface';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';

@Injectable()
export class ChatService {
  // A map to hold active stream subjects, keyed by streamId.
  private readonly chatStreams: Map<string, Subject<string>> = new Map();

  constructor(
    private imageProcessor: ImageProcessorService,
    private documentProcessor: DocumentProcessorService,
    private workflowService: WorkflowService,
    private langSmith: LangSmithService,
  ) {}

  /**
   * Sets up a chat stream, begins processing, and returns the stream ID.
   * The actual workflow runs in the background.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async initiateChat(
    request: ChatRequestDto,
    files?: Express.Multer.File[],
  ): Promise<string> {
    const streamId = uuidv4();
    const sessionId = request.sessionId || uuidv4();
    const chatStream = new Subject<string>();
    this.chatStreams.set(streamId, chatStream);

    const startTime = Date.now();

    // Run the workflow asynchronously.
    const runWorkflow = async () => {
      try {
        const workflowState: WorkflowState = {
          textInput: request.message,
          images: [],
          documents: [],
          retrievedContext: [],
          chatHistory: [],
          sessionId,
          finalResponse: undefined,
        };

        if (files && files.length > 0) {
          await this.processFiles(files, workflowState);
        }
        
        // Execute the workflow and pass a callback to handle streaming chunks.
        const result = await this.workflowService.executeWorkflow(
          workflowState,
          (chunk: string) => {
            chatStream.next(chunk); // Push chunks to the stream.
          }
        );

        // After completion, log the full interaction.
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
        await this.langSmith.logInteraction(sessionId, request, { ...response }, { processingTime });

      } catch (error) {
        await this.langSmith.traceRun('chat_service_error', { sessionId }, {}, error as Error);
        chatStream.error(error); // Propagate errors to the stream.
      } finally {
        // Signal completion and clean up resources.
        chatStream.complete();
        this.chatStreams.delete(streamId);
      }
    };

    runWorkflow(); // Start the process without awaiting it.

    return streamId;
  }

  /**
   * Returns an observable for a given stream ID.
   */
  getChatStream(streamId: string): Observable<MessageEvent> {
    const chatStream = this.chatStreams.get(streamId);
    if (!chatStream) {
      throw new HttpException('Invalid or expired stream ID', HttpStatus.NOT_FOUND);
    }

    return chatStream.asObservable().pipe(
      map((chunk): MessageEvent => ({
        // Format the data for SSE. The client will receive this object.
        data: { chunk },
      })),
    );
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
      'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    return documentMimeTypes.includes(file.mimetype);
  }
}
