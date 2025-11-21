import matter from 'gray-matter'
import path from 'path'

export interface ParsedNote {
  content: string
  frontmatter: Record<string, any>
  title: string
  links: string[] // wikilinks found in the note
  tags: string[]
}

export class MarkdownParser {
  /**
   * Parse a markdown file and extract frontmatter, content, links, and tags
   */
  parse(content: string, filePath: string): ParsedNote {
    // Parse frontmatter using gray-matter
    const { data: frontmatter, content: markdownContent } = matter(content)

    // Extract title (from frontmatter, H1 heading, or filename)
    const title = this.extractTitle(frontmatter, markdownContent, filePath)

    // Extract wikilinks [[link]]
    const links = this.extractWikilinks(markdownContent)

    // Extract tags #tag
    const tags = this.extractTags(markdownContent, frontmatter)

    return {
      content: markdownContent,
      frontmatter,
      title,
      links,
      tags,
    }
  }

  /**
   * Extract title from various sources
   */
  private extractTitle(
    frontmatter: Record<string, any>,
    content: string,
    filePath: string
  ): string {
    // 1. Check frontmatter for title
    if (frontmatter.title && typeof frontmatter.title === 'string') {
      return frontmatter.title
    }

    // 2. Check for H1 heading
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) {
      return h1Match[1].trim()
    }

    // 3. Use filename without extension
    return path.basename(filePath, path.extname(filePath))
  }

  /**
   * Extract wikilinks from markdown content
   * Supports: [[link]], [[link|alias]], [[link#heading]]
   */
  private extractWikilinks(content: string): string[] {
    const wikilinkRegex = /\[\[([^\]]+)\]\]/g
    const links: string[] = []
    let match

    while ((match = wikilinkRegex.exec(content)) !== null) {
      let link = match[1]

      // Remove alias if present (link|alias)
      if (link.includes('|')) {
        link = link.split('|')[0]
      }

      // Remove heading anchor if present (link#heading)
      if (link.includes('#')) {
        link = link.split('#')[0]
      }

      link = link.trim()
      if (link && !links.includes(link)) {
        links.push(link)
      }
    }

    return links
  }

  /**
   * Extract tags from markdown content and frontmatter
   * Supports: #tag, #nested/tag
   */
  private extractTags(content: string, frontmatter: Record<string, any>): string[] {
    const tags = new Set<string>()

    // Extract from frontmatter
    if (frontmatter.tags) {
      if (Array.isArray(frontmatter.tags)) {
        frontmatter.tags.forEach((tag: any) => {
          if (typeof tag === 'string') {
            tags.add(tag.replace(/^#/, ''))
          }
        })
      } else if (typeof frontmatter.tags === 'string') {
        tags.add(frontmatter.tags.replace(/^#/, ''))
      }
    }

    // Extract from content
    const tagRegex = /#([\w\/\-]+)/g
    let match

    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1]
      tags.add(tag)
    }

    return Array.from(tags)
  }

  /**
   * Convert a file path to a note ID (relative to vault)
   */
  static getNoteId(filePath: string, vaultPath: string): string {
    const relativePath = path.relative(vaultPath, filePath)
    // Remove .md extension and normalize path separators
    return relativePath.replace(/\.md$/, '').replace(/\\/g, '/')
  }

  /**
   * Resolve a wikilink to a file path
   * This handles links like "Note Name" or "folder/Note Name"
   */
  static resolveWikilink(link: string, vaultPath: string): string {
    // Normalize the link
    const normalizedLink = link.replace(/\\/g, '/')

    // If link doesn't end with .md, add it
    const linkWithExtension = normalizedLink.endsWith('.md')
      ? normalizedLink
      : `${normalizedLink}.md`

    return path.join(vaultPath, linkWithExtension)
  }
}
