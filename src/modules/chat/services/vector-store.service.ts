import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pinecone } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { CohereEmbeddings } from '@langchain/cohere';
import { Document } from '@langchain/core/documents';
import { ProcessedContent } from '../interfaces/processor.interface';
import { LangSmithService } from './langsmith.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private pinecone: Pinecone;
  private embeddings: CohereEmbeddings;
  private pineconeStore: PineconeStore;

  constructor(
    private langSmith: LangSmithService,
    private configService: ConfigService,
  ) {
    this.pinecone = new Pinecone({
      apiKey: this.configService.get<string>('PINECONE_API_KEY')!,
    });

    this.embeddings = new CohereEmbeddings({
      apiKey: this.configService.get<string>('COHERE_API_KEY'),
      model: 'embed-english-v3.0',
    });
  }

  async onModuleInit() {
    await this.initializeVectorStore();
  }

  private async initializeVectorStore() {
    try {
      const indexName = this.configService.get<string>('PINECONE_INDEX_NAME')!;
      const pineconeIndex = this.pinecone.index<Record<string, any>>(indexName);
      this.pineconeStore = new PineconeStore(this.embeddings, { pineconeIndex });
    } catch (error) {
      await this.langSmith.traceRun(
        'vector_store_init_error',
        {},
        undefined,
        error as Error,
      );
      throw error;
    }
  }

  async storeContent(
    content: ProcessedContent[],
    sessionId: string,
  ): Promise<void> {
    try {
      const documents = content.map((c) => {
        const flattenedMetadata: Record<string, any> = {
          type: c.type,
          sessionId,
          timestamp: new Date().toISOString(),
        };

        for (const [key, value] of Object.entries(c.metadata)) {
          if (key === 'dimensions' && typeof value === 'object' && value !== null) {
            flattenedMetadata[`${key}_width`] = value.width;
            flattenedMetadata[`${key}_height`] = value.height;
          } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            flattenedMetadata[key] = value;
          }
        }
        
        return new Document({
          pageContent: c.content,
          metadata: flattenedMetadata,
        });
      });
      await this.pineconeStore.addDocuments(documents);

      await this.langSmith.traceRun(
        'vector_store_content',
        {
          sessionId,
          contentCount: content.length,
        },
        { success: true },
      );
    } catch (error) {
      await this.langSmith.traceRun(
        'vector_store_error',
        { sessionId },
        {},
        error as Error,
      );
      throw error;
    }
  }

  async searchSimilar(
    query: string,
    sessionId: string,
    limit = 5,
    additionalFilter?: Record<string, any>,
  ): Promise<string[]> {
    try {
      const filter = {
        sessionId,
        ...additionalFilter,
      };

      const results = await this.pineconeStore.similaritySearch(query, limit, filter);

      const documents = results.map(doc => doc.pageContent);

      await this.langSmith.traceRun(
        'vector_search',
        {
          query,
          sessionId,
          filter,
          resultsCount: documents.length,
        },
        { documents },
      );

      return documents;
    } catch (error) {
      await this.langSmith.traceRun(
        'vector_search_error',
        { query, sessionId },
        {},
        error as Error,
      );
      return [];
    }
  }
}
