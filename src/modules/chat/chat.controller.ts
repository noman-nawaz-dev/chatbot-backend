import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { ChatService } from './services/chat.service';
import { ChatRequestDto } from './dto/chat.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { storage, multerFileFilter } from 'src/common/utils/multer.util';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage,
      fileFilter: multerFileFilter,
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  async create(
    @Body() request: ChatRequestDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<ChatRequestDto> {
    try {
      if (!request.message && (!files || files.length === 0)) {
        throw new HttpException(
          'Either text message or files must be provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      return await this.chatService.processChat(request, files);
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
}
