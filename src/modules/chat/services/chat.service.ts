// src/chat/services/chat.service.ts

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ChatRequestDto, ChatResponseDto } from '../dto/chat.dto';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessorService } from './image-processor.service';
import { DocumentProcessorService } from './document-processor.service';
import { WorkflowService } from './workflow.service';
import { LangSmithService } from './langsmith.service';
import { CloudinaryService } from './cloudinary.service';
import { SupabaseService } from './supabase.service';
import { WorkflowState } from '../interfaces/processor.interface';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';
import { VectorStoreService } from './vector-store.service';
import { ChatHistoryEntry } from '../interfaces/processor.interface';

@Injectable()
export class ChatService {
  private readonly chatStreams: Map<string, Subject<string>> = new Map();

  constructor(
    private imageProcessor: ImageProcessorService,
    private documentProcessor: DocumentProcessorService,
    private workflowService: WorkflowService,
    private langSmith: LangSmithService,
    private cloudinaryService: CloudinaryService,
    private supabaseService: SupabaseService,
    private vectorStore: VectorStoreService,
  ) {}

  /**
   * Sets up a chat stream, begins processing, and returns the stream ID.
   * The actual workflow runs in the background.
   */
  // eslint-disable-next-line
  async initiateChat(
    request: ChatRequestDto,
    files?: Express.Multer.File[],
  ): Promise<string> {
    const streamId = uuidv4();
    const sessionId = request.sessionId || uuidv4();
    const chatStream = new Subject<string>();
    this.chatStreams.set(streamId, chatStream);

    const startTime = Date.now();

    const runWorkflow = async () => {
      try {
        const chatHistory = await this.getChatHistory(sessionId, -3);

        const workflowState: WorkflowState = {
          textInput: request.message,
          images: [],
          documents: [],
          retrievedContext: [],
          chatHistory: chatHistory,
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
            chatStream.next(chunk);
          }
        );

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

        const finalResponse = result.finalResponse ?? 'No response generated';
        const userMessage = request.message ?? 'No message provided';
        const chatTitle = result.title
        await this.saveChatHistory(sessionId, userMessage, finalResponse, chatTitle as string);

      } catch (error) {
        await this.langSmith.traceRun('chat_service_error', { sessionId }, {}, error as Error);
        chatStream.error(error);
      } finally {
        chatStream.complete();
        this.chatStreams.delete(streamId);
      }
    };

    runWorkflow();

    return streamId;
  }

  getChatStream(streamId: string): Observable<MessageEvent> {
    const chatStream = this.chatStreams.get(streamId);
    if (!chatStream) {
      throw new HttpException('Invalid or expired stream ID', HttpStatus.NOT_FOUND);
    }

    return chatStream.asObservable().pipe(
      map((chunk): MessageEvent => ({
        data: { chunk },
      })),
    );
  }

  async getChatHistory(sessionId: string, limit?: number): Promise<ChatHistoryEntry[]> {
    try {
      const fileUrl = await this.supabaseService.getHistoryUrl(sessionId);
      if (!fileUrl) {
        return [];
      }
      
      const chatHistory =  await this.cloudinaryService.downloadChatHistory(fileUrl);
      return limit? chatHistory.slice(limit): chatHistory
    } catch (error) {
      console.error('Error retrieving chat history:', error);
      return [];
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

  private async saveChatHistory(
    sessionId: string,
    userMessage: string,
    llmResponse: string,
    chatTitle: string
  ): Promise<void> {
    try {
      const existingFileUrl = await this.supabaseService.getHistoryUrl(sessionId);
      let chatHistory: ChatHistoryEntry[] = [];

      if (existingFileUrl) {
        try {
          chatHistory = await this.cloudinaryService.downloadChatHistory(existingFileUrl);
        } catch (error) {
          console.warn('Failed to download existing chat history, starting fresh:', error);
        }
      }

      const newEntry: ChatHistoryEntry = {
        timestamp: new Date().toISOString(),
        userMessage,
        llmResponse,
      };
      chatHistory.push(newEntry);

      const newFileUrl = await this.cloudinaryService.uploadChatHistory(
        sessionId,
        chatHistory,
      );
      await this.supabaseService.upsertHistoryUrl(sessionId, newFileUrl);
      if (chatTitle !== ""){
        await this.supabaseService.insertHistoryTitle(sessionId, chatTitle)
      }
      console.log(`Chat history file updated in Cloudinary for session ${sessionId}`);
    } catch (error) {
      console.error('Error saving chat history:', error);
    }
  }
}
