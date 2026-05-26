import type { Metadata } from "next";
import { Bree_Serif, Source_Sans_3 } from "next/font/google";
import styles from "./page.module.css";

const displayFont = Bree_Serif({
  variable: "--camp-display-font",
  weight: "400",
  subsets: ["latin"],
});

const bodyFont = Source_Sans_3({
  variable: "--camp-body-font",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Estes Family Camp Printable Meal Plan",
  description: "Printable shopping, prep, packing, recipe, and camp execution checklist for the Estes Family Camp.",
};

const tripSummary = [
  ["Departure", "Thursday morning, May 28"],
  ["Headcount", "12 people"],
  ["Sunday plan", "Breakfast out"],
  ["Print use", "Designed as a working checklist"],
];

const menuByDay = [
  {
    day: "Thursday",
    meals: [
      "Dinner: chicken kabobs, satay sauce, naan, microwave rice, cucumber salad, cake",
    ],
  },
  {
    day: "Friday",
    meals: [
      "Breakfast: pancakes, eggs, sausage, berries and cream",
      "Lunch: Texas toast grilled cheese, tomato soup, strawberry jam, Tabasco optional",
      "Dinner: sous vide pork tenderloins, balsamic glaze, garlic parmesan smashed potatoes, green beans, s'mores",
    ],
  },
  {
    day: "Saturday",
    meals: [
      "Breakfast: pancakes, eggs, sausage, fruit",
      "Lunch: premade chicken tenders, deep fried in the wok",
      "Dinner: ground beef tacos, watermelon, fried biscuit donuts with glaze",
    ],
  },
];

const shoppingSections = [
  {
    title: "Proteins",
    items: [
      "5 to 5.5 lb boneless skinless chicken thighs for kabobs",
      "4 pork tenderloins, about 4.5 to 5 lb total",
      "20 to 24 slices prosciutto",
      "8 to 10 lb premade chicken tenders",
      "5 lb ground beef",
      "36 eggs",
      "48 breakfast sausage links or patties",
    ],
  },
  {
    title: "Produce",
    items: [
      "4 English cucumbers",
      "1 red onion for cucumber salad",
      "4 bell peppers",
      "3 red onions for kabobs",
      "3 zucchini",
      "6 scallions",
      "2 heads garlic",
      "1 large knob fresh ginger",
      "3 lb berries",
      "6 to 8 cups fruit for Saturday breakfast",
      "6 lb baby Yukon gold or red potatoes",
      "3 lb green beans",
      "2 heads lettuce or 2 bags shredded lettuce for tacos",
      "6 to 8 tomatoes for tacos",
      "2 onions for tacos",
      "8 limes",
      "1 large watermelon",
      "12 Roma tomatoes for salsa",
      "2 to 3 peppers for salsa",
    ],
  },
  {
    title: "Dairy + Refrigerated",
    items: [
      "2 lb butter",
      "1 pint cream",
      "28 slices American cheese",
      "14 slices thin aged provolone",
      "14 to 18 oz Gruyere",
      "1.5 to 2 lb shredded taco cheese",
      "2 tubs sour cream",
      "1 cup grated parmesan, plus extra if wanted",
    ],
  },
  {
    title: "Bakery + Grains",
    items: [
      "Pancake mix for 60 to 72 pancakes",
      "2 bottles syrup",
      "2 loaves Texas toast",
      "8 to 9 naan pieces",
      "9 to 10 microwave rice packs",
      "30 to 36 tortillas",
      "1 9x13 cake or 18 to 24 cupcakes",
      "3 cans Pillsbury biscuit dough",
      "2 boxes graham crackers",
    ],
  },
  {
    title: "Pantry + Sauces",
    items: [
      "Peanut butter",
      "Soy sauce",
      "White vinegar",
      "Balsamic vinegar",
      "Brown sugar",
      "Vegetable or neutral oil",
      "Fresh frying oil for donuts",
      "6 to 7 cans condensed tomato soup",
      "Powdered sugar",
      "Vanilla",
      "Worcestershire sauce",
      "Taco seasoning or homemade taco spices",
      "1 to 2 cans El Pato",
      "Strawberry jam",
      "1 bottle Tabasco",
      "Kosher salt, pepper, garlic powder, onion powder",
    ],
  },
  {
    title: "Snacks + Dessert Extras",
    items: [
      "4 large bags tortilla chips",
      "Popcorn for 18 to 20 cups popped",
      "Chex cereal, pretzels, nuts optional",
      "Chocolate chips for muddy buddies",
      "Extra peanut butter for muddy buddies",
      "Favorite candies",
      "2 bags marshmallows",
      "12 full-size chocolate bars or equivalent",
    ],
  },
];

const prepTimeline = [
  {
    day: "Monday",
    focus: "Inventory + pantry + snacks",
    steps: [
      "Inventory coolers, camp stove, Blackstone, wok, grill tools, and serving bins",
      "Shop all nonperishables and snack ingredients",
      "Make Chex mix",
      "Make pink popcorn",
      "Make muddy buddies",
      "Portion favorite candies into one snack tote or snack bags",
    ],
  },
  {
    day: "Tuesday",
    focus: "Perishables + sauces + pork",
    steps: [
      "Shop all perishables and meats",
      "Make homemade salsa",
      "Make doubled satay sauce",
      "Make homemade balsamic glaze, if not buying it",
      "Wrap pork tenderloins in herbs and prosciutto",
      "Sous vide pork tenderloins, then ice-bath and chill",
      "Optional taco option: brown and season all taco beef, cool, and refrigerate",
    ],
  },
  {
    day: "Wednesday",
    focus: "Main prep day",
    steps: [
      "Marinate and skewer chicken kabobs",
      "Prep kabob vegetables",
      "Make cucumber salad",
      "Parboil potatoes",
      "Trim green beans",
      "Wash berries and fruit",
      "Portion breakfast ingredients for Friday and Saturday",
      "Pre-stack grilled cheese cheese packs",
      "Chop taco toppings",
      "Buy or bake cake",
      "Stage dry bins and labels",
    ],
  },
  {
    day: "Thursday Morning",
    focus: "Load-out",
    steps: [
      "Ice and load coolers in meal order",
      "Pack rice pouches and naan",
      "Pack frying oil and fresh donut oil separately",
      "Load snack tote and dessert tote",
      "Verify jam, Tabasco, salsa, and s'mores bin",
      "Final kitchen tool check before departure",
    ],
  },
];

const recipeCards = [
  {
    title: "Satay Sauce, Doubled",
    ingredients: [
      "4 tbsp vegetable oil",
      "6 scallions, chopped fine",
      "2 garlic cloves, chopped fine",
      "2 tbsp grated fresh ginger",
      "2 cups water",
      "1 cup peanut butter",
      "1/2 cup soy sauce",
      "1/2 cup white vinegar",
      "6 tbsp brown sugar",
      "1/2 tsp red pepper flakes",
    ],
    method: [
      "Saute scallions, garlic, and ginger in oil for about 1 minute",
      "Add everything else and bring to a simmer",
      "Stir until smooth",
      "Cool completely and chill up to 3 days",
      "Thin with hot water if needed before serving",
    ],
  },
  {
    title: "Homemade Balsamic Glaze",
    ingredients: [
      "2 cups balsamic vinegar",
      "1/4 cup brown sugar, optional but helpful",
    ],
    method: [
      "Simmer until reduced by about half",
      "Cook until it lightly coats a spoon",
      "Cool and pack in a squeeze bottle or jar",
    ],
  },
  {
    title: "Homemade Salsa",
    ingredients: [
      "12 Roma tomatoes",
      "5 garlic cloves",
      "2 to 3 peppers",
      "1 onion",
      "1 to 2 cans El Pato",
      "Salt to taste",
    ],
    method: [
      "Roast tomatoes, onion, peppers, and garlic until blistered",
      "Blend with El Pato and salt",
      "Chill before packing",
    ],
  },
  {
    title: "Pink Popcorn",
    ingredients: [
      "18 to 20 cups plain popped popcorn",
      "2 cups sugar",
      "1/2 cup water",
      "1/4 cup light corn syrup",
      "2 tbsp butter",
      "Pink food coloring",
      "Pinch of salt",
    ],
    method: [
      "Cook sugar mixture to a light candy stage",
      "Toss lightly with popcorn",
      "Spread thin on parchment or sheet pans",
      "Let dry until crisp, not sticky",
    ],
  },
];

const packingSections = [
  {
    title: "Cooler 1: raw and breakfast items",
    items: [
      "Chicken kabobs",
      "Pork tenderloins",
      "Breakfast sausage",
      "Eggs",
      "Cheeses",
      "Butter",
      "Cream",
      "Berries and fruit",
    ],
  },
  {
    title: "Cooler 2: sides and ready items",
    items: [
      "Cucumber salad",
      "Green beans",
      "Taco toppings",
      "Sour cream",
      "Watermelon if pre-cut",
      "Chicken tenders",
      "Drinks and extra ice",
    ],
  },
  {
    title: "Dry breakfast bin",
    items: [
      "Pancake mix",
      "Syrup",
      "Salt and pepper",
      "Griddle tools",
      "Serving utensils",
      "Paper goods for breakfast",
    ],
  },
  {
    title: "Dry lunch and dinner bin",
    items: [
      "Tomato soup",
      "Rice pouches",
      "Naan",
      "Tortillas",
      "Strawberry jam",
      "Tabasco",
      "Taco seasoning",
      "Chips and salsa",
    ],
  },
  {
    title: "Snack and dessert bin",
    items: [
      "Pink popcorn",
      "Chex mix",
      "Muddy buddies",
      "Favorite candies",
      "Cake",
      "S'mores supplies",
      "Powdered sugar and vanilla for donut glaze",
      "Biscuit dough",
    ],
  },
  {
    title: "Camp kitchen tools",
    items: [
      "Wok",
      "Blackstone tools",
      "Grill tongs",
      "Spider strainer or long tongs for frying",
      "Frying thermometer",
      "Soup pot",
      "Knife and cutting board",
      "Serving bowls and spoons",
      "Foil pans",
      "Labels or masking tape",
    ],
  },
];

const campExecution = [
  {
    title: "Thursday dinner",
    steps: [
      "Microwave rice first",
      "Grill kabobs",
      "Warm naan last",
      "Serve cucumber salad cold",
      "Put satay sauce on the side",
      "Serve cake after dinner",
    ],
  },
  {
    title: "Friday breakfast",
    steps: [
      "Cook sausage first",
      "Scramble eggs second",
      "Run pancakes continuously",
      "Set out berries and cream while pancakes finish",
    ],
  },
  {
    title: "Friday lunch",
    steps: [
      "Heat soup first",
      "Build grilled cheese assembly-line style",
      "Cook lower and slower for Texas toast and Gruyere melt",
      "Serve jam and Tabasco on the side",
    ],
  },
  {
    title: "Friday dinner",
    steps: [
      "Start smashed potatoes on the Blackstone in batches",
      "Cook green beans while potatoes crisp",
      "Sear the sous vide pork last",
      "Brush with balsamic glaze near the end",
      "Rest, slice, and serve",
      "Do s'mores later at the fire",
    ],
  },
  {
    title: "Saturday breakfast",
    steps: [
      "Repeat the exact Friday breakfast setup",
      "Swap berries and cream for fruit",
    ],
  },
  {
    title: "Saturday lunch",
    steps: [
      "Heat wok oil to 350 F",
      "Fry chicken tenders in small batches",
      "Drain well on racks or paper towels",
      "Serve with sauces if wanted",
    ],
  },
  {
    title: "Saturday dinner",
    steps: [
      "Reheat pre-cooked taco meat or brown fresh beef",
      "Warm tortillas",
      "Set out taco toppings buffet-style",
      "Cut and serve watermelon",
      "Clean the wok completely",
      "Use fresh oil for donuts only",
      "Fry biscuit donuts and glaze while warm",
    ],
  },
];

const noteItems = [
  "Use fresh oil for donuts, not the chicken-tender oil.",
  "Keep the sous vide pork and optional pre-cooked taco meat chilled until camp use.",
  "Microwave rice replaces all camp rice cooking.",
  "Make all snacks and salsa at home, not at camp.",
];

function ChecklistItem({ children }: { children: React.ReactNode }) {
  return (
    <li className={styles.checkItem}>
      <span className={styles.box} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export default function CampMealsPage() {
  return (
    <main className={`${styles.page} ${displayFont.variable} ${bodyFont.variable}`}>
      <section className={styles.printHeader}>
        <div>
          <p className={styles.kicker}>Printable Camp Kitchen Plan</p>
          <h1 className={styles.title}>Estes Family Camp Meal Checklist</h1>
        </div>
        <div className={styles.summaryCard}>
          {tripSummary.map(([label, value]) => (
            <div key={label} className={styles.summaryRow}>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Menu At A Glance</h2>
        <div className={styles.gridThree}>
          {menuByDay.map((entry) => (
            <article key={entry.day} className={styles.card}>
              <h3>{entry.day}</h3>
              <ul className={styles.plainList}>
                {entry.meals.map((meal) => (
                  <li key={meal}>{meal}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Shopping Checklist</h2>
        <div className={styles.gridTwo}>
          {shoppingSections.map((section) => (
            <article key={section.title} className={styles.card}>
              <h3>{section.title}</h3>
              <ul className={styles.checkList}>
                {section.items.map((item) => (
                  <ChecklistItem key={item}>{item}</ChecklistItem>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Prep Timeline</h2>
        <div className={styles.gridTwo}>
          {prepTimeline.map((day) => (
            <article key={day.day} className={styles.card}>
              <h3>{day.day}</h3>
              <p className={styles.subhead}>{day.focus}</p>
              <ul className={styles.checkList}>
                {day.steps.map((step) => (
                  <ChecklistItem key={step}>{step}</ChecklistItem>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Recipe Reference</h2>
        <div className={styles.gridTwo}>
          {recipeCards.map((card) => (
            <article key={card.title} className={styles.card}>
              <h3>{card.title}</h3>
              <p className={styles.subsectionLabel}>Ingredients</p>
              <ul className={styles.plainList}>
                {card.ingredients.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className={styles.subsectionLabel}>Method</p>
              <ol className={styles.numberList}>
                {card.method.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Packing Inventory</h2>
        <div className={styles.gridTwo}>
          {packingSections.map((section) => (
            <article key={section.title} className={styles.card}>
              <h3>{section.title}</h3>
              <ul className={styles.checkList}>
                {section.items.map((item) => (
                  <ChecklistItem key={item}>{item}</ChecklistItem>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>At-Camp Execution</h2>
        <div className={styles.gridTwo}>
          {campExecution.map((entry) => (
            <article key={entry.title} className={styles.card}>
              <h3>{entry.title}</h3>
              <ul className={styles.checkList}>
                {entry.steps.map((step) => (
                  <ChecklistItem key={step}>{step}</ChecklistItem>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Critical Notes</h2>
        <article className={styles.card}>
          <ul className={styles.checkList}>
            {noteItems.map((item) => (
              <ChecklistItem key={item}>{item}</ChecklistItem>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
