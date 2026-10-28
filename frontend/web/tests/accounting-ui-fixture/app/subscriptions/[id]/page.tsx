import { SubscriptionFixture } from '../../../subscription-fixture';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubscriptionFixture id={id} />;
}
