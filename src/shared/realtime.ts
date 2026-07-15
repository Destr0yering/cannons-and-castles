export function battleChannel(postId: string): string {
  const safePostId = postId.replace(/[^A-Za-z0-9_]/g, '_');
  return `cannons_castles_${safePostId}`;
}
