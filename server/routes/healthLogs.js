const express = require('express');
const auth = require('../middleware/auth');
const HealthLog = require('../models/HealthLog');
const User = require('../models/User');
const HealthInsight = require('../models/HealthInsight');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  try {
    const {
      sleep,
      mood,
      energy,
      water,
      exercise,
      nutrition,
      symptoms,
      notes
    } = req.body;
    
    const healthLog = new HealthLog({
      user: req.user.id,
      sleep,
      mood,
      energy,
      water,
      exercise,
      nutrition,
      symptoms,
      notes
    });

    healthLog.calculateHealthScore();
    
    await healthLog.save();
    
    const recentLogs = await HealthLog.find({ user: req.user.id })
      .sort({ date: -1 })
      .limit(7);
      
    if (recentLogs.length > 0) {
      const totalScore = recentLogs.reduce((sum, log) => sum + (log.calculatedScore || 0), 0);
      const avgScore = Math.round(totalScore / recentLogs.length);
      
      await User.findByIdAndUpdate(req.user.id, { healthScore: avgScore });
    }
    
    await generateInsights(req.user.id);
    
    res.status(201).json({
      success: true,
      data: healthLog
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const logs = await HealthLog.find({ user: req.user.id }).sort({ date: -1 });
    
    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const log = await HealthLog.findById(req.params.id);
    
    if (!log) {
      return res.status(404).json({ message: 'Health log not found' });
    }
    
    if (log.user.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    
    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/summary', auth, async (req, res) => {
  try {

    const latestLog = await HealthLog.findOne({ user: req.user.id }).sort({ date: -1 });
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const logs = await HealthLog.find({
      user: req.user.id,
      date: { $gte: sevenDaysAgo }
    }).sort({ date: 1 });
    
    const trends = {
      sleep: [],
      mood: [],
      water: [],
      exercise: [],
      scores: []
    };
    
    logs.forEach(log => {
      const date = log.date.toISOString().split('T')[0];
      
      if (log.sleep && log.sleep.hours) {
        trends.sleep.push({ date, value: log.sleep.hours });
      }
      
      if (log.water && log.water.glasses) {
        trends.water.push({ date, value: log.water.glasses });
      }
      
      if (log.mood) {
        const moodValue = {
          'terrible': 1,
          'bad': 2,
          'neutral': 3,
          'good': 4,
          'great': 5
        }[log.mood] || 3;
        
        trends.mood.push({ date, value: moodValue });
      }
      
      if (log.exercise && log.exercise.minutes) {
        trends.exercise.push({ date, value: log.exercise.minutes });
      }
      
      if (log.calculatedScore) {
        trends.scores.push({ date, value: log.calculatedScore });
      }
    });
    
    res.json({
      success: true,
      data: {
        latestLog,
        trends
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

async function generateInsights(userId) {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const logs = await HealthLog.find({
      user: userId,
      date: { $gte: sevenDaysAgo }
    }).sort({ date: 1 });
    
    if (logs.length < 3) {

      return;
    }
    
    const insights = [];
    
    const sleepHours = logs.map(log => log.sleep?.hours).filter(hours => hours);
    if (sleepHours.length >= 3) {
      const avgSleep = sleepHours.reduce((sum, hours) => sum + hours, 0) / sleepHours.length;
      
      if (avgSleep < 6) {
        insights.push({
          user: userId,
          insightType: 'pattern',
          title: 'Low Sleep Detected',
          description: `You've been averaging ${avgSleep.toFixed(1)} hours of sleep, which is below the recommended 7-9 hours.`,
          metrics: ['sleep'],
          severity: 'medium',
          suggestedActions: [
            'Try to go to bed 30 minutes earlier',
            'Limit screen time before bed',
            'Create a relaxing bedtime routine'
          ]
        });
      }
    }
    
    const waterIntake = logs.map(log => log.water?.glasses).filter(glasses => glasses !== undefined);
    if (waterIntake.length >= 3) {
      const avgWater = waterIntake.reduce((sum, glasses) => sum + glasses, 0) / waterIntake.length;
      

      if (avgWater < 5) {
        insights.push({
          user: userId,
          insightType: 'suggestion',
          title: 'Increase Water Intake',
          description: `You've been drinking an average of ${avgWater.toFixed(1)} glasses of water daily. Consider increasing to at least 8 glasses.`,
          metrics: ['water'],
          severity: 'low',
          suggestedActions: [
            'Keep a water bottle nearby',
            'Set reminders to drink water throughout the day',
            'Drink a glass of water before each meal'
          ]
        });
      }
    }
    
    const moodValues = {
      'terrible': 1,
      'bad': 2,
      'neutral': 3,
      'good': 4,
      'great': 5
    };
    
    const moods = logs.map(log => log.mood ? moodValues[log.mood] : null).filter(m => m);
    if (moods.length >= 3) {
      const avgMood = moods.reduce((sum, m) => sum + m, 0) / moods.length;
      
      if (avgMood < 2.5) {
        insights.push({
          user: userId,
          insightType: 'alert',
          title: 'Mood Alert',
          description: 'Your mood has been consistently low recently. This may be affecting your overall well-being.',
          metrics: ['mood'],
          severity: 'high',
          suggestedActions: [
            'Try to engage in activities you enjoy',
            'Consider speaking with a mental health professional',
            'Practice mindfulness or meditation',
            'Get some sunlight and fresh air daily'
          ]
        });
      }
    }
    
    const exerciseDays = logs.filter(log => log.exercise && log.exercise.didExercise).length;
    const exerciseRate = exerciseDays / logs.length;
    
    if (exerciseRate < 0.3 && logs.length >= 5) {
      insights.push({
        user: userId,
        insightType: 'suggestion',
        title: 'Increase Physical Activity',
        description: `You've only exercised on ${exerciseDays} of the last ${logs.length} days. Regular physical activity can boost your mood and energy.`,
        metrics: ['exercise'],
        severity: 'medium',
        suggestedActions: [
          'Try a short daily walk',
          'Consider body-weight exercises that don\'t require equipment',
          'Find a physical activity you enjoy',
          'Start with just 10-15 minutes of movement daily'
        ]
      });
    }
    
    if (insights.length > 0) {
      await HealthInsight.insertMany(insights);
    }
    
  } catch (error) {
    console.error('Error generating insights:', error);
  }
}

module.exports = router; 