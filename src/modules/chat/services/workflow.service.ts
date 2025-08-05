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
      if (allContent.length > 0) {
        await this.vectorStore.storeContent(allContent, initialState.sessionId);
      }

      const query = initialState.textInput || 'summarize the provided context';
      
      const retrievedContext = await this.vectorStore.searchSimilar(
        query, 
        initialState.sessionId, 
        5,
      );

      const stateForPrompt: WorkflowState = { ...initialState, retrievedContext };
      const prompt = this.buildContextPrompt(stateForPrompt);
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

      const finalState: WorkflowState = { ...initialState, retrievedContext, finalResponse };

      await this.langSmith.traceRun('workflow_execution', {
        sessionId: initialState.sessionId,
      }, {
        success: true,
        finalResponseLength: finalState.finalResponse?.length || 0,
      });

      return finalState;

    } catch (error) {
      await this.langSmith.traceRun('workflow_execution_error', { sessionId: initialState.sessionId }, {}, error as Error);
      throw error;
    }
  }

  private buildContextPrompt(state: WorkflowState): string {
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
    if (state.retrievedContext.length > 0) {
      prompt += `Here is some potentially relevant context retrieved from uploaded files and chat history:\n---\n${state.retrievedContext.join('\n---\n')}\n---\n\n`;
    }

    // Section 3: The user's latest message.
    if (state.textInput) {
      prompt += `The user has just sent this message: "${state.textInput}"\n\n`;
    } else {
      prompt += `The user has just uploaded files. Please provide a summary or a relevant response based on the uploaded content and context.\n\n`;
    }

    prompt += 'Based on all the information provided (especially the most recent messages), generate a comprehensive and relevant response.';
    return prompt;
  }
}
