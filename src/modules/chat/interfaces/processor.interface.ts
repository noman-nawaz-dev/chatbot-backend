export interface ProcessedContent {
  type: 'text' | 'image' | 'document';
  content: string;
  metadata: Record<string, any>;
}

export interface ChatHistoryEntry {
  timestamp: string;
  userMessage: string;
  llmResponse: string;
}

export interface ChatHistoryTitle {
  sessionId: string;
  title: string;
  created_at: string;
}

export interface WorkflowState {
  textInput?: string;
  images: ProcessedContent[];
  documents: ProcessedContent[];
  retrievedContext: string[];
  chatHistory?: ChatHistoryEntry[];
  finalResponse?: string;
  sessionId: string;
  userId?: string;
  title?: string
}
