import { Injectable } from '@nestjs/common';
import { Client as LangSmithClient } from 'langsmith';
import { ConfigService } from '@nestjs/config';
import { ChatRequestDto } from '../dto/chat.dto';

@Injectable()
export class LangSmithService {
  private client: LangSmithClient;

  constructor(private configService: ConfigService) {
    this.client = new LangSmithClient({
      apiKey: this.configService.get<string>('LANGSMITH_API_KEY'),
      apiUrl: this.configService.get<string>(
        'LANGSMITH_API_URL',
        'https://api.smith.langchain.com',
      ),
    });
  }

  async traceRun(
    name: string,
    inputs: Record<string, unknown>,
    outputs?: Record<string, unknown>,
    error?: Error,
  ): Promise<void> {
    try {
      await this.client.createRun({
        name,
        inputs,
        run_type: 'tool',
        outputs,
        error: error?.message,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
      });
    } catch (err) {
      console.error('LangSmith tracing error:', err);
    }
  }

  async logInteraction(
    sessionId: string,
    input: ChatRequestDto,
    output: Record<string, unknown>,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.traceRun(
      'chat_interaction',
      {
        sessionId,
        input,
        metadata,
      },
      output,
    );
  }
}
