import { createPredictionApiHandler } from '@/services/prediction-api';
import { mlPredictionProvider } from '@/services/ml-prediction-provider';

export const runtime = 'nodejs';

// Like the existing read-only flood-data routes, predictions require no bearer token.
export const POST = createPredictionApiHandler(mlPredictionProvider);
