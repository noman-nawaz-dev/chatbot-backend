import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpStatus,
  HttpException,
  Sse,
  Param,
  MessageEvent,
} from '@nestjs/common';
import { ChatService } from './services/chat.service';
import { ChatRequestDto } from './dto/chat.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { storage, multerFileFilter } from 'src/common/utils/multer.util';
import { Observable } from 'rxjs';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Initiates the chat process. It receives the user's message and files,
   * starts the background processing, and immediately returns a unique streamId.
   */
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage,
      fileFilter: multerFileFilter,
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    }),
  )
  async create(
    @Body() request: ChatRequestDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<{ streamId: string }> {
    try {
      if (!request.message && (!files || files.length === 0)) {
        throw new HttpException(
          'Either text message or files must be provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      const streamId = await this.chatService.initiateChat(request, files);
      return { streamId };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Processing failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Establishes a Server-Sent Events (SSE) connection. The client connects
   * to this endpoint using the streamId to receive the LLM response in real-time.
   * @param streamId The unique ID for the chat stream.
   * @returns An Observable that emits message events.
   */
  @Sse('stream/:streamId')
  stream(@Param('streamId') streamId: string): Observable<MessageEvent> {
    return this.chatService.getChatStream(streamId);
  }
}
