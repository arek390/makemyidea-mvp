import type { MouseEvent as ReactMouseEvent } from 'react'
import type {
  BlogArticleContent,
  BlogArticleTextSegment,
  BlogId,
  Translations,
} from './copy'

export type BlogPageProps = {
  copy: Translations
  logoUrl: string
  selectedBlogId: BlogId | null
  onSelectBlog: (blogId: BlogId) => void
  onStartClick: (event?: ReactMouseEvent<HTMLAnchorElement>) => void
}

const blogIds: BlogId[] = ['blog-1', 'blog-2', 'blog-3']

function renderBlogArticleText(content: BlogArticleTextSegment[]) {
  return content.map((segment, index) => {
    const key = `${segment.text}-${index}`
    if (segment.strong) return <strong key={key}>{segment.text}</strong>
    if (segment.emphasis) return <em key={key}>{segment.text}</em>
    return <span key={key}>{segment.text}</span>
  })
}

function renderBlogArticleContent(content: BlogArticleContent) {
  if (typeof content === 'string') return <p>{content}</p>

  return content.map((block, index) => {
    if (block.type === 'list') {
      const className =
        block.level && block.level > 0
          ? 'blog-article-list blog-article-list--nested'
          : 'blog-article-list'
      const children = block.items.map((item, itemIndex) => (
        <li key={`item-${index}-${itemIndex}`}>{renderBlogArticleText(item)}</li>
      ))
      if (block.ordered) {
        return (
          <ol className={className} start={block.start ?? 1} key={`list-${index}`}>
            {children}
          </ol>
        )
      }
      return (
        <ul className={className} key={`list-${index}`}>
          {children}
        </ul>
      )
    }
    if (block.type === 'lineGroup') {
      return (
        <div className="blog-article-lines" key={`lines-${index}`}>
          {block.lines.map((line, lineIndex) => (
            <p key={`line-${index}-${lineIndex}`}>{renderBlogArticleText(line)}</p>
          ))}
        </div>
      )
    }
    if (block.type === 'section') {
      return (
        <div className={block.className} key={`section-${index}`}>
          {renderBlogArticleContent(block.blocks)}
        </div>
      )
    }
    if (block.type === 'qaList') {
      return (
        <div className="blog-article-qa" key={`qa-${index}`}>
          {block.pairs.map((pair, pairIndex) => (
            <div className="blog-article-qa-pair" key={`qa-${index}-${pairIndex}`}>
              <p>{renderBlogArticleText(pair.question)}</p>
              <p>{renderBlogArticleText(pair.answer)}</p>
            </div>
          ))}
        </div>
      )
    }
    if (block.type === 'divider') {
      return <hr className="blog-article-divider" key={`divider-${index}`} />
    }

    return <p key={`paragraph-${index}`}>{renderBlogArticleText(block.content)}</p>
  })
}

export function BlogPage({
  copy,
  logoUrl,
  selectedBlogId,
  onSelectBlog,
  onStartClick,
}: BlogPageProps) {
  const selectedIndex = selectedBlogId ? blogIds.indexOf(selectedBlogId) : -1
  const selectedItem = selectedIndex >= 0 ? copy.blogItems[selectedIndex] : null

  return (
    <div className="app examples-page">
      <header className="top-bar examples-top">
        <a className="examples-logo" href="/">
          <img src={logoUrl} alt="MakeMyIdea.Work" />
        </a>
        <a className="ghost examples-home-link" href="/">
          {copy.examplesBackHome}
        </a>
      </header>

      <main className="examples-main">
        <section className="examples-hero">
          <div className="examples-inner">
            <h1>{copy.blogTitle}</h1>
            <p>{copy.blogDescription}</p>

            <div className="examples-grid" role="tablist" aria-label={copy.blogTitle}>
              {copy.blogItems.map((item, index) => {
                const blogId = blogIds[index] ?? 'blog-1'
                const isActive = selectedBlogId === blogId
                return (
                  <button
                    key={blogId}
                    type="button"
                    className={`examples-card ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectBlog(blogId)}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <span className="examples-card-title">{item.title}</span>
                    <span className="examples-card-description">{item.description}</span>
                  </button>
                )
              })}
            </div>

            {selectedItem && (
              <>
                <section className="examples-preview" aria-labelledby="blog-preview-title">
                  <div className="examples-preview-header">
                    <h2 id="blog-preview-title">{selectedItem.title}</h2>
                  </div>
                  <div className="examples-preview-sections">
                    <article className="blog-article">
                      {renderBlogArticleContent(selectedItem.article)}
                    </article>
                  </div>
                </section>
                <div className="blog-article-cta">
                  <a
                    className="primary landing-cta"
                    href="/login"
                    onClick={onStartClick}
                  >
                    {copy.landingCta}
                  </a>
                  <div className="landing-microcopy">
                    <span>{copy.landingCtaNote}</span>
                    {copy.landingIntroCtaNoteLines[1] && (
                      <span>{copy.landingIntroCtaNoteLines[1]}</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
