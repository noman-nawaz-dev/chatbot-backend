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

      const query = initialState.textInput || 'relevant context based on uploaded files';
      const retrievedContext = await this.vectorStore.searchSimilar(query, initialState.sessionId, 5);

      const stateForPrompt: WorkflowState = { ...initialState, retrievedContext };
      const prompt = this.buildContextPrompt(stateForPrompt);
      
      // Use the .stream() method which returns an async iterator
      const stream = await this.llm.stream(prompt);

      let finalResponse = '';
      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          finalResponse += content;
          onChunk(content); // Use the callback to send the chunk back
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
    let prompt = 'You are a helpful AI assistant. ';
    if (state.textInput) prompt += `User message: "${state.textInput}"\n\n`;
    if (state.images.length > 0) prompt += `Image Analysis Results:\n${state.images.map(img => img.content).join('\n')}\n\n`;
    if (state.documents.length > 0) prompt += `Document Content Available:\n${state.documents.length} document chunks processed\n\n`;
    if (state.retrievedContext.length > 0) prompt += `Relevant Context:\n${state.retrievedContext.join('\n---\n')}\n\n`;
    prompt += 'Please provide a comprehensive response based on all available information.';
    return prompt;
  }
}
