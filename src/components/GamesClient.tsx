"use client";

import { useMemo, useState } from "react";
import type { ImportantDateRecord, PersonRecord } from "@/lib/google/types";

type GamesClientProps = {
  people: PersonRecord[];
  importantDates: ImportantDateRecord[];
};

function shuffle<T>(input: T[]) {
  const copy = [...input];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function GamesClient({ people, importantDates }: GamesClientProps) {
  const [nameRound, setNameRound] = useState(0);
  const [nameGuess, setNameGuess] = useState("");
  const [nameResult, setNameResult] = useState<string | null>(null);

  const [birthdayRound, setBirthdayRound] = useState(0);
  const [birthdayChoice, setBirthdayChoice] = useState<string | null>(null);
  const [birthdayResult, setBirthdayResult] = useState<string | null>(null);

  const [hobbyRound, setHobbyRound] = useState(0);
  const [hobbyChoice, setHobbyChoice] = useState<string | null>(null);
  const [hobbyResult, setHobbyResult] = useState<string | null>(null);

  const nameQuestion = useMemo(() => {
    if (people.length === 0) {
      return null;
    }
    return people[nameRound % people.length];
  }, [people, nameRound]);

  const birthdayQuestion = useMemo(() => {
    const birthdayLike = importantDates.filter((item) => item.title.toLowerCase().includes("birthday"));
    const source = birthdayLike.length > 0 ? birthdayLike : importantDates;
    if (source.length === 0) {
      return null;
    }

    const target = source[birthdayRound % source.length];
    const optionPool = shuffle(source.map((item) => item.date)).filter((date) => date !== target.date);
    const options = shuffle([target.date, ...optionPool.slice(0, 3)]);
    return { target, options };
  }, [birthdayRound, importantDates]);

  const hobbyQuestion = useMemo(() => {
    const withHobbies = people.filter((person) => person.hobbies.trim().length > 0);
    if (withHobbies.length === 0) {
      return null;
    }
    const target = withHobbies[hobbyRound % withHobbies.length];
    const wrongChoices = shuffle(
      withHobbies
        .map((person) => person.hobbies.trim())
        .filter((hobby) => hobby && hobby !== target.hobbies.trim()),
    ).slice(0, 3);
    const options = shuffle([target.hobbies.trim(), ...wrongChoices]);
    return { target, options };
  }, [hobbyRound, people]);

  return (
    <div className="games-stack">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Game 1: Name That Person</h2>
        {!nameQuestion ? (
          <p>No people data available yet.</p>
        ) : (
          <>
            <p>Type this person&apos;s full name exactly.</p>
            <p>
              <strong>Clue:</strong> {nameQuestion.displayName.split(" ").map((part) => `${part[0] ?? ""}_`).join(" ")}
            </p>
            <input className="input" value={nameGuess} onChange={(e) => setNameGuess(e.target.value)} />
            <button
              type="button"
              className="button tap-button"
              onClick={() => {
                const ok = nameGuess.trim() === nameQuestion.displayName.trim();
                setNameResult(ok ? "Correct!" : `Not quite. Correct answer: ${nameQuestion.displayName}`);
              }}
            >
              Submit Answer
            </button>
            {nameResult ? <p>{nameResult}</p> : null}
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => {
                setNameRound((n) => n + 1);
                setNameGuess("");
                setNameResult(null);
              }}
            >
              Next Question
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Game 2: Name The Birthday</h2>
        {!birthdayQuestion ? (
          <p>No important dates available yet.</p>
        ) : (
          <>
            <p>
              Which date matches: <strong>{birthdayQuestion.target.title}</strong>?
            </p>
            <div className="game-options">
              {birthdayQuestion.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`button secondary tap-button ${birthdayChoice === option ? "game-option-selected" : ""}`}
                  onClick={() => setBirthdayChoice(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button tap-button"
              onClick={() => {
                if (!birthdayChoice) {
                  setBirthdayResult("Choose an option first.");
                  return;
                }
                setBirthdayResult(
                  birthdayChoice === birthdayQuestion.target.date
                    ? "Correct!"
                    : `Not quite. Correct answer: ${birthdayQuestion.target.date}`,
                );
              }}
            >
              Check Answer
            </button>
            {birthdayResult ? <p>{birthdayResult}</p> : null}
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => {
                setBirthdayRound((n) => n + 1);
                setBirthdayChoice(null);
                setBirthdayResult(null);
              }}
            >
              Next Question
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Game 3: Name Hobbies/Interests</h2>
        {!hobbyQuestion ? (
          <p>No hobbies data available yet.</p>
        ) : (
          <>
            <p>
              Which hobbies match <strong>{hobbyQuestion.target.displayName}</strong>?
            </p>
            <div className="game-options">
              {hobbyQuestion.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`button secondary tap-button ${hobbyChoice === option ? "game-option-selected" : ""}`}
                  onClick={() => setHobbyChoice(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button tap-button"
              onClick={() => {
                if (!hobbyChoice) {
                  setHobbyResult("Choose an option first.");
                  return;
                }
                setHobbyResult(
                  hobbyChoice === hobbyQuestion.target.hobbies.trim()
                    ? "Correct!"
                    : `Not quite. Correct answer: ${hobbyQuestion.target.hobbies.trim()}`,
                );
              }}
            >
              Check Answer
            </button>
            {hobbyResult ? <p>{hobbyResult}</p> : null}
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => {
                setHobbyRound((n) => n + 1);
                setHobbyChoice(null);
                setHobbyResult(null);
              }}
            >
              Next Question
            </button>
          </>
        )}
      </section>
    </div>
  );
}
