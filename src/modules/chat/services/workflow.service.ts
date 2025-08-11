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
      modelName: this.configService.get<string>('OPENAI_MODEL'),
      temperature: 0.7,
      streaming: true, 
    });
  }

  /**
   * Executes the main logic, now accepting a callback to stream chunks.
   * @param onChunk A function to call with each new piece of content.
   */
  async executeWorkflow(
    initialState: WorkflowState,
    onChunk: (chunk: string) => void,
  ): Promise<WorkflowState> {
    try {
      const allContent = [...initialState.images, ...initialState.documents];
      const query = initialState.textInput || 'summarize the provided context';
      let retrievedContext: string[] = [];
      let newUploadsContext: string[] | undefined;

      if (allContent.length > 0) {
        newUploadsContext = allContent.slice(0, 5).map((c) => c.content);
      }

      retrievedContext = await this.vectorStore.searchSimilar(
        query,
        initialState.sessionId,
        5,
      );

      const stateForPrompt: WorkflowState = { ...initialState, retrievedContext };
      const prompt = this.buildContextPrompt(stateForPrompt, { newUploadsContext });
      console.log(prompt)
      const stream = await this.llm.stream(prompt);

      let finalResponse = '';
      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          finalResponse += content;
          onChunk(content);
        }
      }

      let title = ""
      if(initialState.chatHistory?.length === 0) {
        title = (await this.llm.invoke(`As an AI Assistant, give me the title of the following chat response in 3 to 6 words:\nUser Message: ${initialState.textInput}\n AI response: ${finalResponse}\nNote:Do not add Title word in it`)).content as string
        title = title.replace(/^"|"$/g, '');
      }
      const finalState: WorkflowState = { ...initialState, retrievedContext, finalResponse, title };
      await this.langSmith.traceRun('workflow_execution', {
        sessionId: initialState.sessionId,
      }, {
        success: true,
        finalResponseLength: finalState.finalResponse?.length || 0,
      });

      if (allContent.length > 0) {
        void this.vectorStore
          .storeContent(allContent, initialState.sessionId)
          .catch(async (err: unknown) => {
            await this.langSmith.traceRun(
              'vector_store_deferred_error',
              { sessionId: initialState.sessionId },
              {},
              err as Error,
            );
          });
      }

      return finalState;

    } catch (error) {
      await this.langSmith.traceRun('workflow_execution_error', { sessionId: initialState.sessionId }, {}, error as Error);
      throw error;
    }
  }

  private buildContextPrompt(
    state: WorkflowState,
    options?: { newUploadsContext?: string[] },
  ): string {
    let prompt = 'You are a helpful AI assistant.\n\n';

    // Section 1: Full, linear conversation history of last 3 interactions
    if (state.chatHistory && state.chatHistory.length > 0) {
      prompt += 'Here is the recent conversation history:\n';
      state.chatHistory.forEach(entry => {
        prompt += `User: ${entry.userMessage}\nAssistant: ${entry.llmResponse}\nTimestamp: ${entry.timestamp}\n`;
      });
      prompt += '\n';
    }

    // Section 2: Context from external files (documents, images, etc.).
    if (options?.newUploadsContext && options.newUploadsContext.length > 0) {
      prompt += `The user has just uploaded new files in this message. Treat this as primary context:\n---\n${options.newUploadsContext.join('\n---\n')}\n---\n\n`;
    }
    if (state.retrievedContext.length > 0) {
      prompt += `Additionally, here is relevant context retrieved from previously uploaded files for this session:\n---\n${state.retrievedContext.join('\n---\n')}\n---\n\n`;
    }

    // Section 3: The user's latest message.
    if (state.textInput) {
      prompt += `The user has just sent this message: "${state.textInput}"\n\n`;
    } else if (options?.newUploadsContext && options.newUploadsContext.length > 0) {
      prompt += `No explicit message provided. Summarize or respond based on the newly uploaded files and any relevant context.\n\n`;
    } else {
      prompt += `No explicit message provided. Summarize or respond based on the available context.\n\n`;
    }

    prompt += 'Based on all the information provided (especially the most recent messages), generate a comprehensive and relevant response.';
    return prompt;
  }
}
