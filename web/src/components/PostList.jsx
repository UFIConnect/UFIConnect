function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function PostList({
  posts = [],
  loading = false,
  emptyTitle = 'No posts yet',
  emptyDesc = 'Posts shared by this member will show up here.',
  emptyAction = null,
  showAuthor = true,
  maxWidth = 640,
}) {
  if (loading) {
    return (
      <div style={{ maxWidth, textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
        Loading posts...
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="card" style={{ maxWidth, textAlign: 'center', padding: '32px 24px' }}>
        <div style={{ fontSize: '2rem', marginBottom: 10 }}>Posts</div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{emptyTitle}</div>
        <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: emptyAction ? '0 0 16px' : 0 }}>
          {emptyDesc}
        </p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div style={{ maxWidth }}>
      {posts.map((post) => (
        <div key={post.id} className="card post-card" style={{ marginBottom: 12 }}>
          {showAuthor ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div className="avatar avatar-sm">{initials(post.author?.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.85rem' }}>{post.author?.name || 'Member'}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.author?.title || 'UFIConnect Member'}{post.group ? ` - ${post.group.name}` : ''}
                </div>
              </div>
              <span style={{ fontSize: '.7rem', color: 'var(--muted)', flexShrink: 0 }}>{timeAgo(post.createdAt)}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--primary)' }}>
                {post.group?.name || 'UFIConnect'}
              </span>
              <span style={{ fontSize: '.7rem', color: 'var(--muted)', flexShrink: 0 }}>{timeAgo(post.createdAt)}</span>
            </div>
          )}

          <p style={{ margin: '0 0 10px', fontSize: '.9rem', lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
            {post.content}
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
              {post.likesCount || 0} likes
            </span>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
              {post.commentsCount || 0} comments
            </span>
            {post.group && (
              <span style={{
                fontSize: '.72rem', fontWeight: 600, marginLeft: 'auto',
                color: 'var(--primary)', background: 'var(--primary-light)',
                padding: '2px 8px', borderRadius: 10,
              }}>
                {post.group.name}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
