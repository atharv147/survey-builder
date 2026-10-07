require("dotenv").config();
const Response = require("./Models/Response");
const mongoose = require("mongoose");
const Survey = require("./Models/Survey");
const User = require("./Models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Question = require("./Models/Question");
const path = require("path");

const express = require("express");
const app = express();
app.use(express.json());
function requireAuth(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Please log in first"
        });
    }

    const token = header.slice(7);

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET,
            { algorithms: ["HS256"] }
        );

        if (!mongoose.isObjectIdOrHexString(decoded.userId)) {
            return res.status(401).json({
                message: "Invalid token"
            });
        }

        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }
}


app.get("/surveys", requireAuth, async (req, res) => {
    try {
        const surveys = await Survey.find({
            creator: req.userId
        });

        res.json(surveys);
    } catch (error) {
        console.error("Fetch surveys:", error.message);
        res.status(500).json({
            message: "Could not fetch surveys"
        });
    }
});

app.post("/surveys", requireAuth, async (req, res) => {
    try {
        const { title, description = "" } = req.body || {};

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({
                message: "A survey title is required"
            });
        }

        if (typeof description !== "string") {
            return res.status(400).json({
                message: "Description must be text"
            });
        }

        const survey = await Survey.create({
            title: title.trim(),
            description: description.trim(),
            creator: req.userId
        });

        res.status(201).json({
            message: "Survey created",
            survey
        });
    } catch (error) {
        console.error("Create survey:", error.message);
        res.status(500).json({
            message: "Could not create survey"
        });
    }
});

app.post("/auth/register", async (req, res) => {
    try {
        const { name, email, password } = req.body || {};

        if (
            typeof name !== "string" || !name.trim() ||
            typeof email !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
            typeof password !== "string" ||
            password.length < 8 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                message: "Provide a name, valid email and password of at least 8 characters (maximum 72 bytes)"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await User.create({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            passwordHash
        });

        res.status(201).json({
            message: "Account created",
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        res.status(500).json({ message: "Registration failed" });
    }
});

app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const user = await User.findOne({
            email: email.trim().toLowerCase()
        }).select("+passwordHash");

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const token = jwt.sign(
            { userId: user._id.toString() },
            process.env.JWT_SECRET,
            { algorithm: "HS256", expiresIn: "2h" }
        );

        res.json({
            message: "Login successful",
            token
        });
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ message: "Login failed" });
    }
});

async function requireSurveyOwner(req, res, next) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({
                message: "Invalid survey ID"
            });
        }

        const survey = await Survey.findById(req.params.id);

        if (!survey) {
            return res.status(404).json({
                message: "Survey not found"
            });
        }

        if (survey.creator.toString() !== req.userId) {
            return res.status(403).json({
                message: "You do not own this survey"
            });
        }

        req.survey = survey;
        next();
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: "Could not verify survey ownership"
        });
    }
}

app.post(
    "/surveys/:id/questions",
    requireAuth,
    requireSurveyOwner,
    async (req, res) => {
        try {
            const { text, type, options = [] } = req.body || {};

            if (typeof text !== "string" || !text.trim()) {
                return res.status(400).json({
                    message: "Question text is required"
                });
            }

            if (!["text", "single-choice"].includes(type)) {
                return res.status(400).json({
                    message: "Type must be text or single-choice"
                });
            }

            if (
                !Array.isArray(options) ||
                options.some(option =>
                    typeof option !== "string" || !option.trim()
                )
            ) {
                return res.status(400).json({
                    message: "Options must be an array of non-empty strings"
                });
            }

            const cleanedOptions = options.map(option => option.trim());

            if (
                type === "single-choice" &&
                (
                    cleanedOptions.length < 2 ||
                    new Set(cleanedOptions).size !== cleanedOptions.length
                )
            ) {
                return res.status(400).json({
                    message: "Provide at least two different options"
                });
            }

            if (type === "text" && cleanedOptions.length > 0) {
                return res.status(400).json({
                    message: "Text questions cannot have options"
                });
            }

            const question = await Question.create({
                survey: req.survey._id,
                text: text.trim(),
                type,
                options: cleanedOptions
            });

            res.status(201).json({
                message: "Question added",
                question
            });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({
                message: "Could not add question"
            });
        }
    }
);

// Public: open a survey and see its questions
app.get("/surveys/:id", async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({
                message: "Invalid survey ID"
            });
        }

        const survey = await Survey.findById(req.params.id)
            .select("title description");

        if (!survey) {
            return res.status(404).json({
                message: "Survey not found"
            });
        }

        const questions = await Question.find({
            survey: survey._id
        }).select("text type options").sort({ _id: 1 });

        res.json({ survey, questions });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: "Could not load survey"
        });
    }
});

// Public: submit answers without logging in
app.post("/surveys/:id/respond", async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({
                message: "Invalid survey ID"
            });
        }

        const survey = await Survey.findById(req.params.id);

        if (!survey) {
            return res.status(404).json({
                message: "Survey not found"
            });
        }

        const questions = await Question.find({
            survey: survey._id
        });

        if (questions.length === 0) {
            return res.status(400).json({
                message: "This survey has no questions yet"
            });
        }

        const { answers } = req.body || {};

        if (!Array.isArray(answers) ||
            answers.length !== questions.length) {
            return res.status(400).json({
                message: "Answer every question exactly once"
            });
        }

        const seen = new Set();
        const cleanedAnswers = [];

        for (const answer of answers) {
            if (
                !answer ||
                typeof answer.question !== "string" ||
                typeof answer.value !== "string" ||
                !answer.value.trim()
            ) {
                return res.status(400).json({
                    message: "Each answer needs a question ID and text value"
                });
            }

            const question = questions.find(
                q => q._id.toString() === answer.question
            );

            if (!question || seen.has(answer.question)) {
                return res.status(400).json({
                    message: "Unknown or repeated question"
                });
            }

            const value = answer.value.trim();

            if (
                question.type === "single-choice" &&
                !question.options.includes(value)
            ) {
                return res.status(400).json({
                    message: "Choose one of the provided options"
                });
            }

            seen.add(answer.question);

            cleanedAnswers.push({
                question: question._id,
                value
            });
        }

        await Response.create({
            survey: survey._id,
            answers: cleanedAnswers
        });

        res.status(201).json({
            message: "Response submitted"
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: "Could not submit response"
        });
    }
});

app.get(
    "/surveys/:id/summary",
    requireAuth,
    requireSurveyOwner,
    async (req, res) => {
        try {
            const surveyId = req.survey._id;

            const totalResponses = await Response.countDocuments({
                survey: surveyId
            });

            const questions = await Question.find({
                survey: surveyId
            }).sort({ _id: 1 });

            const choiceIds = questions
                .filter(q => q.type === "single-choice")
                .map(q => q._id);

            const counts = await Response.aggregate([
                { $match: { survey: surveyId } },

                { $unwind: "$answers" },

                {
                    $match: {
                        "answers.question": { $in: choiceIds }
                    }
                },

                {
                    $group: {
                        _id: {
                            question: "$answers.question",
                            option: "$answers.value"
                        },
                        count: { $sum: 1 }
                    }
                }
            ]);

            const summary = questions.map(question => ({
                questionId: question._id,
                text: question.text,
                type: question.type,
                options: question.type === "single-choice"
                    ? question.options.map(option => {
                        const result = counts.find(row =>
                            row._id.question.toString() ===
                            question._id.toString() &&
                            row._id.option === option
                        );

                        return {
                            option,
                            count: result ? result.count : 0
                        };
                    })
                    : [],
                note: question.type === "text"
                    ? "Free-text answers are not displayed in this summary"
                    : undefined
            }));

            res.json({
                title: req.survey.title,
                totalResponses,
                questions: summary
            });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({
                message: "Could not generate summary"
            });
        }
    }
);

// Update a survey's title or description
app.patch(
    "/surveys/:id",
    requireAuth,
    requireSurveyOwner,
    async (req, res) => {
        try {
            const { title, description } = req.body || {};

            if (title === undefined && description === undefined) {
                return res.status(400).json({
                    message: "Provide a title or description to update"
                });
            }

            if (
                title !== undefined &&
                (typeof title !== "string" || !title.trim())
            ) {
                return res.status(400).json({
                    message: "Title must be non-empty text"
                });
            }

            if (
                description !== undefined &&
                typeof description !== "string"
            ) {
                return res.status(400).json({
                    message: "Description must be text"
                });
            }

            if (title !== undefined) {
                req.survey.title = title.trim();
            }

            if (description !== undefined) {
                req.survey.description = description.trim();
            }

            await req.survey.save();

            res.json({
                message: "Survey updated",
                survey: req.survey
            });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({
                message: "Could not update survey"
            });
        }
    }
);

// Delete a survey and its related data
app.delete(
    "/surveys/:id",
    requireAuth,
    requireSurveyOwner,
    async (req, res) => {
        const session = await mongoose.startSession();

        try {
            await session.withTransaction(async () => {
                await Response.deleteMany({
                    survey: req.survey._id
                }).session(session);

                await Question.deleteMany({
                    survey: req.survey._id
                }).session(session);

                await Survey.deleteOne({
                    _id: req.survey._id,
                    creator: req.userId
                }).session(session);
            });

            res.json({
                message: "Survey and related data deleted"
            });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({
                message: "Could not delete survey"
            });
        } finally {
            await session.endSession();
        }
    }
);

if (process.env.NODE_ENV === "production") {
    const frontendPath = path.join(__dirname, "frontend", "dist");

    app.use(express.static(frontendPath));

    app.get("/{*splat}", (req, res) => {
        res.sendFile(path.join(frontendPath, "index.html"));
    });
} else {
    app.get("/", (req, res) => {
        res.send("survey builder backend is running");
    });
}

const PORT = process.env.PORT || 5001;

async function startServer() {
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing from .env");
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB connected successfully");

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
}

startServer();