export default function VimeoPreview({ id, title, active = true }) {
  return <div style={{ aspectRatio:'16/9', background:'#0d1422', borderRadius:12, overflow:'hidden' }}>
    {active ? <iframe src={'https://player.vimeo.com/video/'+id+'?autoplay=0&dnt=1'} title={title || 'Vimeo video'} loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={{width:'100%',height:'100%',border:0,display:'block'}} /> : <p style={{color:'#fff',padding:24}}>Vimeo video · scroll into view to load the player</p>}
  </div>;
}
