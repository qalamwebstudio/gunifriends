import * as fc from 'fast-check';
import { UniversityEmailValidator } from './validation';
import { UNIVERSITY_DOMAINS } from '../types';

describe('UniversityEmailValidator', () => {
  describe('Property 1: University email validation', () => {
    /**
     * Feature: university-video-chat, Property 1: University email validation
     * Validates: Requirements 1.1
     * 
     * For any email address that doesn't match approved university domain patterns,
     * the authentication service should reject registration and return an error
     */
    it('should reject all non-university email addresses', () => {
      // Generate arbitrary email addresses that are NOT from university domains
      // Use alphanumeric characters for local part to ensure valid email format
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const nonUniversityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(
          'gmail.com',
          'yahoo.com', 
          'hotmail.com',
          'outlook.com',
          'aol.com',
          'icloud.com',
          'protonmail.com',
          'company.com',
          'business.org',
          'random-domain.net'
        )
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      fc.assert(
        fc.property(nonUniversityEmailArbitrary, (email) => {
          const result = UniversityEmailValidator.validateUniversityEmail(email);
          
          // The email should be rejected (not valid for university registration)
          expect(result.isValid).toBe(false);
          expect(result.isUniversityEmail).toBe(false);
          expect(result.universityName).toBe(null);
          expect(result.errors).toContain('Email must be from an approved university domain');
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 1: University email validation
     * Validates: Requirements 1.1
     * 
     * For any valid university email address that matches approved university domain patterns,
     * the authentication service should accept it for registration
     */
    it('should accept all valid university email addresses', () => {
      // Generate valid university email addresses from the approved domains
      // Use alphanumeric characters for local part to ensure valid email format
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const universityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      fc.assert(
        fc.property(universityEmailArbitrary, (email) => {
          const result = UniversityEmailValidator.validateUniversityEmail(email);
          
          // The email should be accepted for university registration
          expect(result.isValid).toBe(true);
          expect(result.isUniversityEmail).toBe(true);
          expect(result.universityName).not.toBe(null);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 1: University email validation
     * Validates: Requirements 1.1
     * 
     * For any malformed email address (invalid format),
     * the authentication service should reject it regardless of domain
     */
    it('should reject all malformed email addresses', () => {
      // Generate malformed email addresses
      const malformedEmailArbitrary = fc.oneof(
        // Missing @ symbol
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('@')),
        // Multiple @ symbols
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 })
        ).map(([a, b, c]) => `${a}@${b}@${c}`),
        // Empty string
        fc.constant(''),
        // Only @ symbol
        fc.constant('@'),
        // Missing domain
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}@`),
        // Missing local part
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `@${s}`),
        // Spaces in email
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 1, maxLength: 10 })
        ).map(([a, b]) => `${a} @${b}.com`)
      );

      fc.assert(
        fc.property(malformedEmailArbitrary, (email) => {
          const result = UniversityEmailValidator.validateUniversityEmail(email);
          
          // All malformed emails should be rejected
          expect(result.isValid).toBe(false);
          expect(result.isUniversityEmail).toBe(false);
          expect(result.universityName).toBe(null);
          expect(result.errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 1: University email validation
     * Validates: Requirements 1.1
     * 
     * For any email address, case sensitivity should not affect validation
     * (emails should be normalized to lowercase)
     */
    it('should handle case insensitivity correctly for university domains', () => {
      // Generate university emails with random case variations
      // Use alphanumeric characters for local part to ensure valid email format
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const caseVariationEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains)),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 })
      ).map(([localPart, domain, casePattern]) => {
        // Apply random case to domain
        let casedDomain = '';
        for (let i = 0; i < domain.length; i++) {
          const shouldUppercase = casePattern[i % casePattern.length];
          casedDomain += shouldUppercase ? domain[i].toUpperCase() : domain[i].toLowerCase();
        }
        return `${localPart}@${casedDomain}`;
      });

      fc.assert(
        fc.property(caseVariationEmailArbitrary, (email) => {
          const result = UniversityEmailValidator.validateUniversityEmail(email);
          
          // Case variations of valid university emails should still be accepted
          expect(result.isValid).toBe(true);
          expect(result.isUniversityEmail).toBe(true);
          expect(result.universityName).not.toBe(null);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 10 }
      );
    });
  });
});