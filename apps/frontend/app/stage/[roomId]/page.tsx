import { LiveStageViewer } from '../../../components/live-comment-viewer';

export default async function StagePage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <LiveStageViewer roomId={roomId} />;
}
