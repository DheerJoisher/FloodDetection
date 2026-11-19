import { getRegionalImpact } from '@/services/regional-impact-engine';
import { withApiErrors, errorResponse } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const featureDate = new URL(request.url).searchParams.get('feature_date');
    if (featureDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(featureDate)) {
        return errorResponse('feature_date must use YYYY-MM-DD format.', 400);
      }
      const parsed = new Date(`${featureDate}T00:00:00.000Z`);
      if (
        Number.isNaN(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== featureDate
      ) {
        return errorResponse('feature_date must be a valid calendar date.', 400);
      }
    }
    return Response.json(await getRegionalImpact(featureDate ?? undefined));
  });
}
