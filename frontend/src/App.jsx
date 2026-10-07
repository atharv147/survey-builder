const API_BASE = import.meta.env.PROD ? "" : "/api";
import { useEffect, useState } from "react";
import "./App.css";

async function api(path, method = "GET", body, token = "") {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

function publicSurveyId() {
  return window.location.hash.startsWith("#/respond/")
    ? window.location.hash.slice("#/respond/".length)
    : "";
}

export default function App() {
  const [token, setToken] = useState("");
  const [register, setRegister] = useState(false);
  const [surveys, setSurveys] = useState([]);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [publicId, setPublicId] = useState(publicSurveyId);
  const [publicData, setPublicData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [questionType, setQuestionType] = useState("single-choice");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    function updatePage() {
      setPublicId(publicSurveyId());
      setMessage("");
    }

    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  useEffect(() => {
    let active = true;
    setPublicData(null);
    setAnswers({});
    setSubmitted(false);

    if (publicId) {
      api(`/surveys/${publicId}`)
        .then(data => {
          if (active) setPublicData(data);
        })
        .catch(error => {
          if (active) setMessage(error.message);
        });
    }

    return () => { active = false; };
  }, [publicId]);

  async function run(action) {
    setBusy(true);
    setMessage("");

    try {
      await action();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSurveys(authToken = token) {
    const data = await api("/surveys", "GET", undefined, authToken);
    setSurveys(data);
  }

  async function openBuilder(id) {
    const data = await api(`/surveys/${id}`);
    setSelected(data);
    setSummary(null);
  }

  function handleAuth(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));

    run(async () => {
      if (register) {
        await api("/auth/register", "POST", body);
      }

      const data = await api("/auth/login", "POST", {
        email: body.email,
        password: body.password
      });

      setToken(data.token);
      await refreshSurveys(data.token);
      setMessage("Logged in successfully");
    });
  }

  function createSurvey(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));

    run(async () => {
      const data = await api("/surveys", "POST", body, token);
      await refreshSurveys();
      await openBuilder(data.survey._id);
      form.reset();
      setMessage("Survey created. Add your questions below.");
    });
  }

  function addQuestion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));

    run(async () => {
      await api(
        `/surveys/${selected.survey._id}/questions`,
        "POST",
        {
          text: fields.text,
          type: questionType,
          options: questionType === "single-choice"
            ? fields.options.split("\n").map(s => s.trim()).filter(Boolean)
            : []
        },
        token
      );

      await openBuilder(selected.survey._id);
      form.reset();
      setMessage("Question added");
    });
  }

  function editSurvey(survey) {
    const title = window.prompt("Survey title:", survey.title);
    if (title === null) return;

    const description = window.prompt(
      "Survey description:",
      survey.description
    );
    if (description === null) return;

    run(async () => {
      await api(`/surveys/${survey._id}`, "PATCH",
        { title, description }, token);
      await refreshSurveys();

      if (selected?.survey._id === survey._id) {
        await openBuilder(survey._id);
      }

      setSummary(null);
      setMessage("Survey updated");
    });
  }

  function deleteSurvey(survey) {
    if (!window.confirm(
      `Delete "${survey.title}" and ALL its questions and responses?`
    )) return;

    run(async () => {
      await api(`/surveys/${survey._id}`, "DELETE", undefined, token);
      setSelected(null);
      setSummary(null);
      await refreshSurveys();
      setMessage("Survey deleted");
    });
  }

  function submitResponse(event) {
    event.preventDefault();

    run(async () => {
      await api(`/surveys/${publicId}/respond`, "POST", {
        answers: publicData.questions.map(question => ({
          question: question._id,
          value: answers[question._id] || ""
        }))
      });

      setSubmitted(true);
      setMessage("Thank you! Your response has been submitted.");
    });
  }

  return (
    <main>
      <header>
        <div>
          <span className="badge">CASE 187</span>
          <h1>Survey Studio</h1>
          <p>Create surveys. Collect feedback. Understand the results.</p>
        </div>

        {!publicId && token && (
          <button className="secondary" onClick={() => {
            setToken("");
            setSurveys([]);
            setSelected(null);
            setSummary(null);
            setMessage("Logged out");
          }}>
            Log out
          </button>
        )}
      </header>

      {message && <div className="notice" role="status">{message}</div>}

      {publicId ? (
        <section className="card">
          <a href="#/">Creator dashboard</a>

          {publicData ? (
            <>
              <h2>{publicData.survey.title}</h2>
              <p>{publicData.survey.description}</p>
              <p className="muted">
                No account is required. Please avoid personal information
                in written answers.
              </p>

              {submitted ? (
                <h3>Response received ✓</h3>
              ) : publicData.questions.length === 0 ? (
                <p>This survey has no questions yet.</p>
              ) : (
                <form onSubmit={submitResponse}>
                  {publicData.questions.map((question, index) => (
                    <label key={question._id}>
                      {index + 1}. {question.text}
                      {question.type === "single-choice" ? (
                        <select required
                          value={answers[question._id] || ""}
                          onChange={event => setAnswers({
                            ...answers,
                            [question._id]: event.target.value
                          })}>
                          <option value="">Choose an option</option>
                          {question.options.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <textarea required
                          value={answers[question._id] || ""}
                          onChange={event => setAnswers({
                            ...answers,
                            [question._id]: event.target.value
                          })}
                        />
                      )}
                    </label>
                  ))}
                  <button disabled={busy}>Submit response</button>
                </form>
              )}
            </>
          ) : (
            <p>{message ? "Unable to open survey." : "Loading survey…"}</p>
          )}
        </section>
      ) : !token ? (
        <section className="card auth">
          <h2>{register ? "Create your account" : "Welcome back"}</h2>
          <form onSubmit={handleAuth}>
            {register && (
              <label>Name<input name="name" required /></label>
            )}
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password"
                minLength={8} required />
            </label>
            <button disabled={busy}>
              {busy ? "Please wait…" : register ? "Register & log in" : "Log in"}
            </button>
          </form>
          <button className="secondary" onClick={() => {
            setRegister(!register);
            setMessage("");
          }}>
            {register ? "Already registered? Log in" : "Create an account"}
          </button>
        </section>
      ) : (
        <>
          <div className="grid">
            <section className="card">
              <h2>Create a survey</h2>
              <form onSubmit={createSurvey}>
                <label>
                  Title<input name="title" required />
                </label>
                <label>
                  Description<textarea name="description" />
                </label>
                <button disabled={busy}>Create survey</button>
              </form>
            </section>

            <section className="card">
              <h2>Your surveys</h2>
              {surveys.length === 0 && <p>No surveys yet.</p>}
              {surveys.map(survey => (
                <article key={survey._id}>
                  <h3>{survey.title}</h3>
                  <p>{survey.description}</p>
                  <div className="actions">
                    <button disabled={busy}
                      onClick={() => run(() => openBuilder(survey._id))}>
                      Questions
                    </button>
                    <button disabled={busy} className="secondary"
                      onClick={() => editSurvey(survey)}>Edit</button>
                    <button disabled={busy} className="secondary"
                      onClick={() => run(async () => {
                        const data = await api(
                          `/surveys/${survey._id}/summary`,
                          "GET", undefined, token
                        );
                        setSummary(data);
                        setSelected(null);
                      })}>
                      Summary
                    </button>
                    <button disabled={busy} className="danger"
                      onClick={() => deleteSurvey(survey)}>Delete</button>
                  </div>
                  <a href={`#/respond/${survey._id}`}
                    target="_blank" rel="noreferrer">
                    Open public response form ↗
                  </a>
                </article>
              ))}
            </section>
          </div>

          {selected && (
            <section className="card">
              <h2>Questions · {selected.survey.title}</h2>
              <p className="muted">
                Finish adding questions before sharing the survey.
                All questions are required.
              </p>
              <ol>
                {selected.questions.map(question => (
                  <li key={question._id}>
                    <strong>{question.text}</strong> — {question.type}
                    {question.options.length > 0 && (
                      <p>{question.options.join(" / ")}</p>
                    )}
                  </li>
                ))}
              </ol>
              <form onSubmit={addQuestion}>
                <label>
                  Question<input name="text" required />
                </label>
                <label>
                  Type
                  <select value={questionType}
                    onChange={event => setQuestionType(event.target.value)}>
                    <option value="single-choice">Single choice</option>
                    <option value="text">Text answer</option>
                  </select>
                </label>
                {questionType === "single-choice" && (
                  <label>
                    Options — one per line
                    <textarea name="options" required
                      placeholder={"Excellent\nGood\nNeeds improvement"} />
                  </label>
                )}
                <button disabled={busy}>Add question</button>
              </form>
            </section>
          )}

          {summary && (
            <section className="card">
              <span className="badge">OWNER-ONLY RESULTS</span>
              <h2>{summary.title}</h2>
              <h3>Total submissions: {summary.totalResponses}</h3>

              {summary.questions.map(question => (
                <article key={question.questionId}>
                  <h3>{question.text}</h3>
                  {question.options.map(item => (
                    <div className="result" key={item.option}>
                      <span>{item.option}</span>
                      <progress value={item.count}
                        max={summary.totalResponses || 1} />
                      <strong>{item.count}</strong>
                    </div>
                  ))}
                  {question.note && <p>{question.note}</p>}
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}