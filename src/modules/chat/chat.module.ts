
import { Module } from '@nestjs/common';
import { ChatService } from './services/chat.service';
import { ChatController } from './chat.controller';
import { LangSmithService } from './services/langsmith.service';
import { ImageProcessorService } from './services/image-processor.service';
import { DocumentProcessorService } from './services/document-processor.service';
import { WorkflowService } from './services/workflow.service';
import { VectorStoreService } from './services/vector-store.service';
import { CloudinaryService } from './services/cloudinary.service';
import { SupabaseService } from './services/supabase.service';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ImageProcessorService,
    DocumentProcessorService,
    LangSmithService,
    WorkflowService,
    VectorStoreService,
    CloudinaryService,
    SupabaseService
  ],
})
export class ChatModule {}
