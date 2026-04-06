import { CardManager, DeckAnalyser } from '../../game';
import { Deck, User } from '../../storage';

interface DeckDefinition {
  name: string;
  cards: string[];
}

const LUCARDIO_CARDS: string[] = [
  ...Array(4).fill('Riolu MEG'),
  ...Array(3).fill('Mega Lucario ex MEG'),
  ...Array(2).fill('Solrock MEG'),
  ...Array(2).fill('Hariyama MEG'),
  ...Array(2).fill('Lunatone MEG'),
  ...Array(2).fill('Makuhita MEG'),
  'Meowth ex POR',
  'Shaymin DRI',
  ...Array(4).fill('Premium Power Pro MEG'),
  ...Array(4).fill('Fighting Gong MEG'),
  ...Array(4).fill('Lillie\'s Determination MEG'),
  ...Array(3).fill('Ultra Ball PLB'),
  ...Array(3).fill('Poke Pad POR'),
  ...Array(3).fill('Carmine TWM'),
  ...Array(2).fill('Night Stretcher SFA'),
  ...Array(2).fill('Team Rocket\'s Watchtower DRI'),
  ...Array(2).fill('Judge DRI'),
  'Air Balloon ASC',
  'Switch SSH',
  'Special Red Card M4',
  'Maximum Belt TEF',
  'Boss\'s Orders MEG',
  ...Array(11).fill('Fighting Energy EVO'),
];

const DRAGAPULT_CARDS: string[] = [
  ...Array(4).fill('Dreepy TWM'),
  ...Array(4).fill('Drakloak TWM'),
  ...Array(3).fill('Dragapult ex TWM'),
  ...Array(2).fill('Meowth ex POR'),
  ...Array(2).fill('Munkidori TWM'),
  ...Array(2).fill('Duskull SFA'),
  ...Array(2).fill('Budew PRE'),
  'Dusclops SFA',
  'Dusknoir PRE',
  'Fezandipiti ex SFA',
  'Lillie\'s Clefairy ex JTG',
  ...Array(4).fill('Lillie\'s Determination MEG'),
  ...Array(4).fill('Ultra Ball PLB'),
  ...Array(4).fill('Poke Pad POR'),
  ...Array(4).fill('Buddy-Buddy Poffin TEF'),
  ...Array(2).fill('Boss\'s Orders MEG'),
  ...Array(2).fill('Night Stretcher SFA'),
  ...Array(2).fill('Rare Candy SUM'),
  ...Array(2).fill('Area Zero Underdepths SCR'),
  ...Array(2).fill('Crispin SCR'),
  'Unfair Stamp TWM',
  'Dawn PFL',
  'Team Rocket\'s Petrel DRI',
  ...Array(2).fill('Darkness Energy EVO'),
  ...Array(3).fill('Psychic Energy EVO'),
  ...Array(3).fill('Fire Energy EVO'),
];

export const DEFAULT_DECKS: DeckDefinition[] = [
  { name: 'Lucardio', cards: LUCARDIO_CARDS },
  { name: 'Dragapult', cards: DRAGAPULT_CARDS },
];

export async function seedDecksForUser(user: User): Promise<void> {
  const existingDecks = await Deck.find({ where: { user }, relations: ['user'] });
  const existingNames = existingDecks.map(d => d.name);

  for (const deckDef of DEFAULT_DECKS) {
    if (existingNames.includes(deckDef.name)) {
      continue;
    }

    const analyser = new DeckAnalyser(deckDef.cards);
    const deck = new Deck();
    deck.user = user;
    deck.name = deckDef.name;
    deck.cards = JSON.stringify(deckDef.cards);
    deck.isValid = analyser.isValid();
    deck.cardTypes = JSON.stringify(analyser.getDeckType());

    try {
      await deck.save();
      console.log(`[seed-decks] Created deck "${deckDef.name}" for user "${user.name}" (valid: ${deck.isValid})`);
    } catch (err: any) {
      console.warn(`[seed-decks] Failed to create deck "${deckDef.name}" for user "${user.name}": ${err.message}`);
    }
  }
}

export async function ensureLocalUser(): Promise<User> {
  let user = await User.findOne(1);
  if (user === undefined) {
    user = new User();
    user.name = 'player';
    user.email = 'player@local';
    user.password = '';
    user.registered = Date.now();
    user.lastSeen = Date.now();
    await user.save();
    console.log('[local-mode] Created local user "player" (id: ' + user.id + ')');
  }
  return user;
}

export async function seedAllUsers(): Promise<void> {
  const cardManager = CardManager.getInstance();

  // Validate all card names
  for (const deckDef of DEFAULT_DECKS) {
    for (const cardName of deckDef.cards) {
      if (!cardManager.isCardDefined(cardName)) {
        console.warn(`[seed-decks] WARNING: Card "${cardName}" not found in CardManager (deck: ${deckDef.name})`);
      }
    }
    if (deckDef.cards.length !== 60) {
      console.warn(`[seed-decks] WARNING: Deck "${deckDef.name}" has ${deckDef.cards.length} cards (expected 60)`);
    }
  }

  // Local-only mode: ensure the local user exists
  const localUser = await ensureLocalUser();

  const users = await User.find();

  for (const user of users) {
    await seedDecksForUser(user);
  }
}
