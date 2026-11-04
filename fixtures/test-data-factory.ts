/**
 * Test data fixtures and generators
 */

import { TestUtils } from '../src/utils/test-utils';

export interface UserData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  userType: 'fan' | 'band' | 'solo_artist';
  genre?: string[];
  instruments?: string[];
  bandMembers?: BandMember[];
}

export interface BandMember {
  name: string;
  instrument: string;
  role: string;
}

export interface EventData {
  title: string;
  description: string;
  date: string;
  time: string;
  venue: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  ticketPrice: number;
  capacity: number;
  genre: string[];
}

export class TestDataFactory {
  /**
   * Generate test user data
   */
  static generateUser(userType: 'fan' | 'band' | 'solo_artist' = 'fan'): UserData {
    const firstName = this.getRandomFirstName();
    const lastName = this.getRandomLastName();
    const email = `test-${firstName.toLowerCase()}-${Date.now()}@example.amazonses.com`;
    
    const userData: UserData = {
      firstName,
      lastName,
      email,
      phone: this.generatePhoneNumber(),
      password: 'TestPassword123!',
      userType
    };

    if (userType === 'band') {
      userData.genre = this.getRandomGenres(2);
      userData.bandMembers = this.generateBandMembers();
    } else if (userType === 'solo_artist') {
      userData.genre = this.getRandomGenres(1);
      userData.instruments = this.getRandomInstruments(2);
    }

    return userData;
  }

  /**
   * Generate test event data
   */
  static generateEvent(): EventData {
    const genres = this.getRandomGenres(1);
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + Math.floor(Math.random() * 30) + 1);

    return {
      title: `${this.getRandomEventTitle()} Concert`,
      description: this.getRandomEventDescription(),
      date: eventDate.toISOString().split('T')[0],
      time: this.getRandomTime(),
      venue: this.getRandomVenue(),
      address: this.getRandomAddress(),
      city: this.getRandomCity(),
      state: this.getRandomState(),
      zipCode: this.generateZipCode(),
      ticketPrice: Math.floor(Math.random() * 100) + 20,
      capacity: Math.floor(Math.random() * 500) + 50,
      genre: genres
    };
  }

  /**
   * Generate multiple users
   */
  static generateUsers(count: number): UserData[] {
    const users: UserData[] = [];
    const userTypes: ('fan' | 'band' | 'solo_artist')[] = ['fan', 'band', 'solo_artist'];
    
    for (let i = 0; i < count; i++) {
      const userType = userTypes[i % userTypes.length];
      users.push(this.generateUser(userType));
    }
    
    return users;
  }

  /**
   * Get random first name
   */
  private static getRandomFirstName(): string {
    const names = [
      'Alex', 'Jamie', 'Taylor', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Drew',
      'Sam', 'Avery', 'Quinn', 'Blake', 'Sage', 'River', 'Rowan', 'Skylar'
    ];
    return names[Math.floor(Math.random() * names.length)];
  }

  /**
   * Get random last name
   */
  private static getRandomLastName(): string {
    const names = [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
      'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
      'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'
    ];
    return names[Math.floor(Math.random() * names.length)];
  }

  /**
   * Generate phone number
   */
  private static generatePhoneNumber(): string {
    return TestUtils.generateRandomPhoneNumber();
  }

  /**
   * Get random genres
   */
  private static getRandomGenres(count: number): string[] {
    const genres = [
      'Rock', 'Pop', 'Jazz', 'Blues', 'Country', 'Electronic', 'Hip Hop',
      'Classical', 'Folk', 'Reggae', 'R&B', 'Indie', 'Alternative', 'Metal'
    ];
    
    const shuffled = [...genres].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  /**
   * Get random instruments
   */
  private static getRandomInstruments(count: number): string[] {
    const instruments = [
      'Guitar', 'Bass', 'Drums', 'Piano', 'Keyboard', 'Violin', 'Saxophone',
      'Trumpet', 'Flute', 'Clarinet', 'Vocals', 'Cello', 'Harmonica', 'Ukulele'
    ];
    
    const shuffled = [...instruments].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  /**
   * Generate band members
   */
  private static generateBandMembers(): BandMember[] {
    const memberCount = Math.floor(Math.random() * 4) + 2; // 2-5 members
    const members: BandMember[] = [];
    
    const roles = ['Lead Vocalist', 'Guitarist', 'Bassist', 'Drummer', 'Keyboardist'];
    const instruments = this.getRandomInstruments(memberCount);
    
    for (let i = 0; i < memberCount; i++) {
      members.push({
        name: `${this.getRandomFirstName()} ${this.getRandomLastName()}`,
        instrument: instruments[i],
        role: roles[i] || 'Musician'
      });
    }
    
    return members;
  }

  /**
   * Get random event title
   */
  private static getRandomEventTitle(): string {
    const titles = [
      'Summer Music Festival', 'Rock Night', 'Jazz Evening', 'Acoustic Session',
      'Electronic Beats', 'Country Roads', 'Indie Showcase', 'Metal Mayhem',
      'Blues Brothers', 'Pop Paradise', 'Folk Tales', 'Classical Concert'
    ];
    return titles[Math.floor(Math.random() * titles.length)];
  }

  /**
   * Get random event description
   */
  private static getRandomEventDescription(): string {
    const descriptions = [
      'Join us for an unforgettable night of live music and entertainment.',
      'Experience the best local talent in an intimate venue setting.',
      'A celebration of music that will leave you wanting more.',
      'Don\'t miss this incredible showcase of musical artistry.',
      'An evening filled with amazing performances and great vibes.'
    ];
    return descriptions[Math.floor(Math.random() * descriptions.length)];
  }

  /**
   * Get random time
   */
  private static getRandomTime(): string {
    const hours = Math.floor(Math.random() * 12) + 7; // 7 PM to 6 AM
    const minutes = Math.random() > 0.5 ? '00' : '30';
    const period = hours <= 11 ? 'PM' : 'AM';
    const displayHour = hours > 12 ? hours - 12 : hours;
    return `${displayHour}:${minutes} ${period}`;
  }

  /**
   * Get random venue
   */
  private static getRandomVenue(): string {
    const venues = [
      'The Music Hall', 'Downtown Theater', 'Rock Palace', 'Jazz Lounge',
      'Concert Arena', 'The Stage', 'Music Box', 'Harmony Hall',
      'Sound Stage', 'The Venue', 'Live House', 'Performance Center'
    ];
    return venues[Math.floor(Math.random() * venues.length)];
  }

  /**
   * Get random address
   */
  private static getRandomAddress(): string {
    const streetNumber = Math.floor(Math.random() * 9999) + 1;
    const streetNames = [
      'Main St', 'Oak Ave', 'Park Blvd', 'First St', 'Broadway',
      'Center St', 'Church St', 'Music Ave', 'Concert Dr', 'Harmony Ln'
    ];
    const streetName = streetNames[Math.floor(Math.random() * streetNames.length)];
    return `${streetNumber} ${streetName}`;
  }

  /**
   * Get random city
   */
  private static getRandomCity(): string {
    const cities = [
      'Austin', 'Nashville', 'Los Angeles', 'New York', 'Chicago',
      'Seattle', 'Portland', 'Denver', 'Atlanta', 'Miami'
    ];
    return cities[Math.floor(Math.random() * cities.length)];
  }

  /**
   * Get random state
   */
  private static getRandomState(): string {
    const states = [
      'TX', 'TN', 'CA', 'NY', 'IL', 'WA', 'OR', 'CO', 'GA', 'FL'
    ];
    return states[Math.floor(Math.random() * states.length)];
  }

  /**
   * Generate zip code
   */
  private static generateZipCode(): string {
    return Math.floor(Math.random() * 90000 + 10000).toString();
  }
}
