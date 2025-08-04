import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { WorkflowState } from '../interfaces/processor.interface';
import { VectorStoreService } from './vector-store.service';
import { LangSmithService } from './langsmith.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkflowService {
  private llm: ChatOpenAI;

  constructor(
    private vectorStore: VectorStoreService,
    private langSmith: LangSmithService,
    private configService: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-4o-mini',
      temperature: 0.7,
    });
  }

  async executeWorkflow(initialState: WorkflowState): Promise<WorkflowState> {
    try {
      // Step 1: Process and store all incoming documents and images
      const allContent = [...initialState.images, ...initialState.documents];
      if (allContent.length > 0) {
        await this.vectorStore.storeContent(allContent, initialState.sessionId);
      }

      // Step 2: Retrieve relevant context from the vector store
      const query = initialState.textInput || 'relevant context based on uploaded files';
      const retrievedContext = await this.vectorStore.searchSimilar(
        query,
        initialState.sessionId,
        5,
      );

      // Step 3: Build the prompt and generate the final response
      const stateForPrompt: WorkflowState = {
        ...initialState,
        retrievedContext,
      };
      const prompt = this.buildContextPrompt(stateForPrompt);
      const response = await this.llm.invoke(prompt);
      const finalResponse = response.content as string;

      // Construct the final state object to be returned
      const finalState: WorkflowState = {
        ...initialState,
        retrievedContext,
        finalResponse,
      };

      await this.langSmith.traceRun('workflow_execution', {
        sessionId: initialState.sessionId,
        hasText: !!initialState.textInput,
        imageCount: initialState.images.length,
        documentCount: initialState.documents.length,
      }, {
        success: true,
        finalResponseLength: finalState.finalResponse?.length || 0,
      });

      return finalState;

    } catch (error) {
      await this.langSmith.traceRun('workflow_execution_error', {
        sessionId: initialState.sessionId,
      }, {}, error as Error);
      throw error;
    }
  }

  /**
   * Helper function to construct the prompt for the language model.
   */
  private buildContextPrompt(state: WorkflowState): string {
    let prompt = 'You are a helpful AI assistant. ';

    if (state.textInput) {
      prompt += `User message: "${state.textInput}"\n\n`;
    }

    if (state.images && state.images.length > 0) {
      prompt += `Image Analysis Results:\n${state.images.map(img => img.content).join('\n')}\n\n`;
    }

    if (state.documents && state.documents.length > 0) {
      prompt += `Document Content Available:\n${state.documents.length} document chunks processed\n\n`;
    }

    if (state.retrievedContext && state.retrievedContext.length > 0) {
      prompt += `Relevant Context:\n${state.retrievedContext.join('\n---\n')}\n\n`;
    }

    prompt += 'Please provide a comprehensive response based on all available information.';

    return prompt;
  }
}
