/**
 * DataValidator - Schema validation and data format versioning
 *
 * Features:
 * - Schema validation for whiteboard data
 * - Data format versioning for future migrations
 * - Automatic migration between versions
 * - Data integrity checks
 */

export const CURRENT_DATA_VERSION = 1;

export interface VersionedData<T> {
  version: number;
  data: T;
  timestamp: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CardPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
}

export interface Arrow {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  sourceType?: 'note' | 'textBox' | 'pdf';
  targetType?: 'note' | 'textBox' | 'pdf';
  sourceSide?: 'top' | 'right' | 'bottom' | 'left';
  targetSide?: 'top' | 'right' | 'bottom' | 'left';
}

export interface CardGroup {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  memberCards: string[];
}

export interface Whiteboard {
  id: string;
  name: string;
  cards: CardPosition[];
  arrows: Arrow[];
  groups: CardGroup[];
  stickyNotes?: any[];
  textBoxes?: any[];
  pdfCards?: any[];
}

export interface WhiteboardMetadata {
  whiteboards: string[];
  activeWhiteboard: string | null;
}

export class DataValidator {
  /**
   * Validate a CardPosition object
   */
  static validateCardPosition(card: any): ValidationResult {
    const errors: string[] = [];

    if (typeof card !== 'object' || card === null) {
      errors.push('Card must be an object');
      return { valid: false, errors };
    }

    if (typeof card.id !== 'string' || !card.id) {
      errors.push('Card must have a valid id string');
    }

    if (typeof card.x !== 'number' || !isFinite(card.x)) {
      errors.push('Card x position must be a finite number');
    }

    if (typeof card.y !== 'number' || !isFinite(card.y)) {
      errors.push('Card y position must be a finite number');
    }

    if (typeof card.width !== 'number' || !isFinite(card.width) || card.width <= 0) {
      errors.push('Card width must be a positive finite number');
    }

    if (typeof card.height !== 'number' || !isFinite(card.height) || card.height <= 0) {
      errors.push('Card height must be a positive finite number');
    }

    if (card.groupId !== undefined && typeof card.groupId !== 'string') {
      errors.push('Card groupId must be a string if present');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate an Arrow object
   */
  static validateArrow(arrow: any): ValidationResult {
    const errors: string[] = [];

    if (typeof arrow !== 'object' || arrow === null) {
      errors.push('Arrow must be an object');
      return { valid: false, errors };
    }

    if (typeof arrow.id !== 'string' || !arrow.id) {
      errors.push('Arrow must have a valid id string');
    }

    if (typeof arrow.sourceNoteId !== 'string' || !arrow.sourceNoteId) {
      errors.push('Arrow must have a valid sourceNoteId string');
    }

    if (typeof arrow.targetNoteId !== 'string' || !arrow.targetNoteId) {
      errors.push('Arrow must have a valid targetNoteId string');
    }

    const validSides = ['top', 'right', 'bottom', 'left'];
    if (arrow.sourceSide !== undefined && !validSides.includes(arrow.sourceSide)) {
      errors.push('Arrow sourceSide must be one of: top, right, bottom, left');
    }

    if (arrow.targetSide !== undefined && !validSides.includes(arrow.targetSide)) {
      errors.push('Arrow targetSide must be one of: top, right, bottom, left');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a CardGroup object
   */
  static validateCardGroup(group: any): ValidationResult {
    const errors: string[] = [];

    if (typeof group !== 'object' || group === null) {
      errors.push('Group must be an object');
      return { valid: false, errors };
    }

    if (typeof group.id !== 'string' || !group.id) {
      errors.push('Group must have a valid id string');
    }

    if (typeof group.name !== 'string') {
      errors.push('Group must have a name string');
    }

    if (typeof group.x !== 'number' || !isFinite(group.x)) {
      errors.push('Group x position must be a finite number');
    }

    if (typeof group.y !== 'number' || !isFinite(group.y)) {
      errors.push('Group y position must be a finite number');
    }

    if (typeof group.width !== 'number' || !isFinite(group.width) || group.width <= 0) {
      errors.push('Group width must be a positive finite number');
    }

    if (typeof group.height !== 'number' || !isFinite(group.height) || group.height <= 0) {
      errors.push('Group height must be a positive finite number');
    }

    if (typeof group.color !== 'string') {
      errors.push('Group must have a color string');
    }

    if (!Array.isArray(group.memberCards)) {
      errors.push('Group memberCards must be an array');
    } else {
      for (let i = 0; i < group.memberCards.length; i++) {
        if (typeof group.memberCards[i] !== 'string') {
          errors.push(`Group memberCards[${i}] must be a string`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a Whiteboard object
   */
  static validateWhiteboard(whiteboard: any): ValidationResult {
    const errors: string[] = [];

    if (typeof whiteboard !== 'object' || whiteboard === null) {
      errors.push('Whiteboard must be an object');
      return { valid: false, errors };
    }

    if (typeof whiteboard.id !== 'string' || !whiteboard.id) {
      errors.push('Whiteboard must have a valid id string');
    }

    if (typeof whiteboard.name !== 'string') {
      errors.push('Whiteboard must have a name string');
    }

    // Validate cards array
    if (!Array.isArray(whiteboard.cards)) {
      errors.push('Whiteboard cards must be an array');
    } else {
      for (let i = 0; i < whiteboard.cards.length; i++) {
        const cardResult = this.validateCardPosition(whiteboard.cards[i]);
        if (!cardResult.valid) {
          errors.push(`Card ${i}: ${cardResult.errors.join(', ')}`);
        }
      }
    }

    // Validate arrows array
    if (!Array.isArray(whiteboard.arrows)) {
      errors.push('Whiteboard arrows must be an array');
    } else {
      for (let i = 0; i < whiteboard.arrows.length; i++) {
        const arrowResult = this.validateArrow(whiteboard.arrows[i]);
        if (!arrowResult.valid) {
          errors.push(`Arrow ${i}: ${arrowResult.errors.join(', ')}`);
        }
      }
    }

    // Validate groups array
    if (!Array.isArray(whiteboard.groups)) {
      errors.push('Whiteboard groups must be an array');
    } else {
      for (let i = 0; i < whiteboard.groups.length; i++) {
        const groupResult = this.validateCardGroup(whiteboard.groups[i]);
        if (!groupResult.valid) {
          errors.push(`Group ${i}: ${groupResult.errors.join(', ')}`);
        }
      }
    }

    // Check referential integrity
    const cardIds = new Set(whiteboard.cards?.map((c: any) => c.id) || []);
    const groupIds = new Set(whiteboard.groups?.map((g: any) => g.id) || []);

    // Arrows can reference cards, sticky notes, text boxes, PDF cards, or highlight cards
    const allValidIds = new Set([
      ...(whiteboard.cards?.map((c: any) => c.id) || []),
      ...(whiteboard.stickyNotes?.map((s: any) => s.id) || []),
      ...(whiteboard.textBoxes?.map((t: any) => t.id) || []),
      ...(whiteboard.pdfCards?.map((p: any) => p.id) || []),
      ...(whiteboard.highlightCards?.map((h: any) => h.id) || [])
    ]);

    // Check arrows reference valid elements (cards, sticky notes, text boxes, PDF cards, or highlight cards)
    if (Array.isArray(whiteboard.arrows)) {
      for (const arrow of whiteboard.arrows) {
        if (!allValidIds.has(arrow.sourceNoteId)) {
          errors.push(`Arrow ${arrow.id} references non-existent element: ${arrow.sourceNoteId}`);
        }
        if (!allValidIds.has(arrow.targetNoteId)) {
          errors.push(`Arrow ${arrow.id} references non-existent element: ${arrow.targetNoteId}`);
        }
      }
    }

    // Check cards reference valid groups
    if (Array.isArray(whiteboard.cards)) {
      for (const card of whiteboard.cards) {
        if (card.groupId && !groupIds.has(card.groupId)) {
          errors.push(`Card ${card.id} references non-existent group: ${card.groupId}`);
        }
      }
    }

    // Check groups reference valid member cards
    if (Array.isArray(whiteboard.groups)) {
      for (const group of whiteboard.groups) {
        if (Array.isArray(group.memberCards)) {
          for (const memberId of group.memberCards) {
            if (!cardIds.has(memberId)) {
              errors.push(`Group ${group.id} references non-existent member card: ${memberId}`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate WhiteboardMetadata
   */
  static validateWhiteboardMetadata(metadata: any): ValidationResult {
    const errors: string[] = [];

    if (typeof metadata !== 'object' || metadata === null) {
      errors.push('Metadata must be an object');
      return { valid: false, errors };
    }

    if (!Array.isArray(metadata.whiteboards)) {
      errors.push('Metadata whiteboards must be an array');
    } else {
      for (let i = 0; i < metadata.whiteboards.length; i++) {
        if (typeof metadata.whiteboards[i] !== 'string') {
          errors.push(`Metadata whiteboards[${i}] must be a string`);
        }
      }
    }

    if (metadata.activeWhiteboard !== null && typeof metadata.activeWhiteboard !== 'string') {
      errors.push('Metadata activeWhiteboard must be a string or null');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Wrap data with version information
   */
  static wrapWithVersion<T>(data: T, version: number = CURRENT_DATA_VERSION): VersionedData<T> {
    return {
      version,
      data,
      timestamp: Date.now(),
    };
  }

  /**
   * Unwrap versioned data and migrate if necessary
   */
  static unwrapVersionedData<T>(versionedData: any): T {
    // If data doesn't have version info, assume it's legacy format (version 1)
    if (!versionedData.version) {
      return versionedData as T;
    }

    const { version, data } = versionedData;

    // Perform migrations if needed
    if (version < CURRENT_DATA_VERSION) {
      return this.migrateData(data, version, CURRENT_DATA_VERSION);
    }

    return data;
  }

  /**
   * Migrate data from one version to another
   */
  private static migrateData<T>(data: any, fromVersion: number, toVersion: number): T {
    let migratedData = data;

    // Future migrations would go here
    // For example:
    // if (fromVersion === 1 && toVersion >= 2) {
    //   migratedData = this.migrateV1ToV2(migratedData);
    // }

    return migratedData;
  }

  /**
   * Sanitize whiteboard data by removing invalid entries
   */
  static sanitizeWhiteboard(whiteboard: Whiteboard): Whiteboard {
    const cardIds = new Set(whiteboard.cards.map(c => c.id));
    const groupIds = new Set(whiteboard.groups.map(g => g.id));

    // Arrows can reference cards, sticky notes, text boxes, or PDF cards
    const allValidIds = new Set([
      ...whiteboard.cards.map(c => c.id),
      ...(whiteboard.stickyNotes || []).map((s: any) => s.id),
      ...(whiteboard.textBoxes || []).map((t: any) => t.id),
      ...(whiteboard.pdfCards || []).map((p: any) => p.id)
    ]);

    // Remove arrows that reference non-existent elements
    const validArrows = whiteboard.arrows.filter(arrow => {
      return allValidIds.has(arrow.sourceNoteId) && allValidIds.has(arrow.targetNoteId);
    });

    // Fix cards that reference non-existent groups
    const validCards = whiteboard.cards.map(card => {
      if (card.groupId && !groupIds.has(card.groupId)) {
        const { groupId, ...cardWithoutGroup } = card;
        return cardWithoutGroup as CardPosition;
      }
      return card;
    });

    // Fix groups that reference non-existent member cards
    const validGroups = whiteboard.groups.map(group => {
      const validMemberCards = group.memberCards.filter(memberId => cardIds.has(memberId));
      return { ...group, memberCards: validMemberCards };
    });

    return {
      ...whiteboard,
      cards: validCards,
      arrows: validArrows,
      groups: validGroups,
    };
  }
}
