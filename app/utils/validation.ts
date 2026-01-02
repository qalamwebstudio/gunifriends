import { UNIVERSITY_DOMAINS, UniversityConfig } from '../types';

/**
 * University email domain validation utilities
 */
export class UniversityEmailValidator {
  private static universityDomains: UniversityConfig[] = UNIVERSITY_DOMAINS;

  /**
   * Check if an email domain is from an approved university
   */
  static isUniversityEmail(email: string): boolean {
    if (!email || typeof email !== 'string') {
      return false;
    }

    const emailLower = email.toLowerCase().trim();
    const domain = this.extractDomain(emailLower);
    
    if (!domain) {
      return false;
    }

    return this.universityDomains.some(university => 
      university.domains.some(universityDomain => 
        domain === universityDomain.toLowerCase()
      )
    );
  }

  /**
   * Get the university name for a given email domain
   */
  static getUniversityName(email: string): string | null {
    if (!email || typeof email !== 'string') {
      return null;
    }

    const emailLower = email.toLowerCase().trim();
    const domain = this.extractDomain(emailLower);
    
    if (!domain) {
      return null;
    }

    const university = this.universityDomains.find(university => 
      university.domains.some(universityDomain => 
        domain === universityDomain.toLowerCase()
      )
    );

    return university ? university.name : null;
  }

  /**
   * Extract domain from email address
   */
  private static extractDomain(email: string): string | null {
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1 || atIndex === email.length - 1) {
      return null;
    }
    return email.substring(atIndex + 1);
  }

  /**
   * Get all supported university domains
   */
  static getSupportedUniversities(): UniversityConfig[] {
    return [...this.universityDomains];
  }

  /**
   * Add a new university domain (for testing or admin purposes)
   */
  static addUniversityDomain(university: UniversityConfig): void {
    this.universityDomains.push(university);
  }

  /**
   * Validate email format and university domain
   */
  static validateUniversityEmail(email: string): {
    isValid: boolean;
    isUniversityEmail: boolean;
    universityName: string | null;
    errors: string[];
  } {
    const errors: string[] = [];
    
    // Check if email is provided
    if (!email || typeof email !== 'string' || email.trim() === '') {
      errors.push('Email is required');
      return {
        isValid: false,
        isUniversityEmail: false,
        universityName: null,
        errors
      };
    }

    const emailTrimmed = email.trim();

    // Check email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailTrimmed)) {
      errors.push('Invalid email format');
    }

    // Check if it's a university email
    const isUniversityEmail = this.isUniversityEmail(emailTrimmed);
    if (!isUniversityEmail) {
      errors.push('Email must be from an approved university domain');
    }

    const universityName = this.getUniversityName(emailTrimmed);

    return {
      isValid: errors.length === 0,
      isUniversityEmail,
      universityName,
      errors
    };
  }
}

/**
 * General email format validation utilities
 */
export class EmailFormatValidator {
  /**
   * Validate basic email format
   */
  static isValidEmailFormat(email: string): boolean {
    if (!email || typeof email !== 'string') {
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Normalize email address (lowercase, trim)
   */
  static normalizeEmail(email: string): string {
    if (!email || typeof email !== 'string') {
      return '';
    }
    return email.trim().toLowerCase();
  }

  /**
   * Check for common email security issues
   */
  static validateEmailSecurity(email: string): {
    isSecure: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    
    if (!email || typeof email !== 'string') {
      warnings.push('Email is required');
      return { isSecure: false, warnings };
    }

    const emailLower = email.toLowerCase().trim();

    // Check for suspicious patterns
    if (emailLower.includes('..')) {
      warnings.push('Email contains consecutive dots');
    }

    if (emailLower.startsWith('.') || emailLower.endsWith('.')) {
      warnings.push('Email cannot start or end with a dot');
    }

    if (emailLower.includes('+')) {
      // This is actually valid (email aliasing), but we might want to flag it
      warnings.push('Email contains plus sign (aliasing detected)');
    }

    // Check for extremely long emails (potential DoS)
    if (emailLower.length > 254) {
      warnings.push('Email address is too long');
    }

    return {
      isSecure: warnings.length === 0,
      warnings
    };
  }
}