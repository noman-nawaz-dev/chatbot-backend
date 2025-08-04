export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProcessedContent {
  type: 'text' | 'image' | 'document';
  content: string;
  metadata: Record<string, any>;
}

export interface WorkflowState {
  textInput?: string;
  images: ProcessedContent[];
  documents: ProcessedContent[];
  retrievedContext: string[];
  chatHistory?: ChatTurn[];
  finalResponse?: string;
  sessionId: string;
}
