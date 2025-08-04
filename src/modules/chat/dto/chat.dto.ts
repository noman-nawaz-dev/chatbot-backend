import { IsString, IsOptional } from 'class-validator';

export class ChatRequestDto {
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  context?: any;
}

export class ChatResponseDto {
  response: string;
  sessionId: string;
  metadata: {
    processedFiles: number;
    processingTime: number;
    vectorStoreHits: number;
  };
}
